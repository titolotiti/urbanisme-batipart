// v3 — Table des matières d'abord, puis scan ciblé = ~3 appels au lieu de 36
import { PDFDocument } from 'pdf-lib';

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération : {OPERATION}{COMMUNE}
IMPORTANT : Si le règlement couvre plusieurs communes, applique UNIQUEMENT les règles de la commune indiquée.

## ① Faisabilité
**Verdict :** ✅ Possible / ⚠️ Sous conditions / ❌ Interdit / ❓ Non précisé
Explication 2-3 phrases.
> *Page XX — Article YY :* "Passage exact."

## ② Logements sociaux
**Obligation :** [Oui X% / Non / Non mentionné]
> *Page XX — Article YY :* "Passage exact."

## ③ Conditions et contraintes
**[Condition]** — Ce que ça implique.
> *Page XX — Article YY :* "Passage exact."

Texte EXACT entre guillemets. Toujours indiquer page et article.`;

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

const FALLBACK_URLS = {
  // Plaine Commune : Partie 2 (zones) = 4MB
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

// Dispositions générales séparées (Partie 1) — combinées avec les zones pour analyse complète
const GENERAL_URLS = {
  // Plaine Commune : Partie 1 (dispositions générales + définitions)
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/200057867_4-1-1_Partie1_Definitions_et_dispositions_generales.pdf',
};

async function getPagesBatch(pdfDoc, from, to) {
  const total = pdfDoc.getPageCount();
  const end = Math.min(to, total);
  if (from >= total) return null;
  const sub = await PDFDocument.create();
  const pages = await sub.copyPages(pdfDoc, [...Array(end - from).keys()].map(i => i + from));
  pages.forEach(p => sub.addPage(p));
  return Buffer.from(await sub.save()).toString('base64');
}

async function callModel(apiKey, content, model) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d.error));
  return d.content[0].text;
}

const callHaiku = (apiKey, content) => callModel(apiKey, content, 'claude-haiku-4-5-20251001');
const callSonnet = (apiKey, content) => callModel(apiKey, content, 'claude-sonnet-4-6');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64, commune, address } = req.body;
  console.log('Params:', { zone, commune, address: address?.slice(0, 40) });
  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const communeInfo = commune ? `\nCommune : ${commune}${address ? ' — ' + address : ''}` : '';
  const prompt = BASE_PROMPT
    .replace('{ZONE}', zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType)
    .replace('{COMMUNE}', communeInfo);

  const baseZone = zone.replace(/[a-z]+$/, '').replace(/-[A-Z0-9-]+$/, '') || zone;
  const familleZone = baseZone.replace(/[0-9]+.*$/, '');

  try {
    // Télécharge le PDF
    let pdfBytes;
    if (pluBase64) {
      pdfBytes = Buffer.from(pluBase64, 'base64');
    } else {
      let url = pluUrl;
      try {
        const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        console.log('Taille:', Math.round(size/1024/1024), 'MB');
        const code = url.match(/DU_(\d+)\//)?.[1];
        // Si taille inconnue (0) ou trop grand → fallback
        if (size === 0 || size > 30 * 1024 * 1024) {
          if (code && FALLBACK_URLS[code]) {
            url = FALLBACK_URLS[code];
            console.log('Fallback URL utilisée');
          } else if (size === 0) {
            console.log('Taille inconnue — téléchargement prudent');
          }
        }
      } catch(e) {}
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Téléchargement échoué (' + r.status + ')');
      pdfBytes = Buffer.from(await r.arrayBuffer());
      console.log('PDF:', Math.round(pdfBytes.length/1024/1024), 'MB');
    }

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    console.log('Pages:', totalPages);

    // Charge aussi les dispositions générales si disponibles (même coût — incluses dans appel 1)
    let generalB64 = null;
    const urlCode = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
    if (urlCode && GENERAL_URLS[urlCode]) {
      try {
        const gr = await fetch(GENERAL_URLS[urlCode], { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (gr.ok) {
          const gb = Buffer.from(await gr.arrayBuffer());
          const gDoc = await PDFDocument.load(gb, { ignoreEncryption: true });
          generalB64 = await getPagesBatch(gDoc, 0, gDoc.getPageCount());
          console.log('Dispositions générales chargées:', gDoc.getPageCount(), 'pages');
        }
      } catch(e) { console.log('Dispositions générales non disponibles'); }
    }

    // ── APPEL 1 : Pages 1-20 (table des matières + début) ──
    // Haiku cherche la page exacte de la zone ET extrait les dispositions générales
    const toc20 = await getPagesBatch(pdfDoc, 0, 20);
    const tocPrompt = `Ce document est un règlement PLU de ${totalPages} pages.
TÂCHE 1 — Cherche dans la table des matières ou le sommaire la page où commence la zone "${zone}" ou "${baseZone}" ou "ZONE ${baseZone}". 
Réponds obligatoirement avec : "PAGE: XX" (ex: "PAGE: 145")
Si tu ne trouves pas de table des matières, cherche dans le texte visible et indique "PAGE: non trouvée".

TÂCHE 2 — Extrait intégralement les dispositions générales, définitions et règles communes à toutes les zones (si présentes dans ces 20 premières pages).`;

    const tocContent = generalB64
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: generalB64 } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toc20 } },
          { type: 'text', text: tocPrompt }
        ]
      : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toc20 } },
          { type: 'text', text: tocPrompt }
        ];
    const tocResult = await callHaiku(apiKey, tocContent);
    console.log('TOC result:', tocResult.slice(0, 100));

    // Extrait le numéro de page
    const pageMatch = tocResult.match(/PAGE:\s*(\d+)/i);
    const zoneStartPage = pageMatch ? parseInt(pageMatch[1]) - 1 : null; // 0-indexed

    let zoneContent = tocResult.replace(/PAGE:\s*\d+/i, '').trim();

    if (zoneStartPage !== null && zoneStartPage > 20) {
      // ── APPEL 2 : Pages de la zone (±40 pages autour de la zone) ──
      const from = Math.max(0, zoneStartPage - 2);
      const to = Math.min(totalPages, zoneStartPage + 80);
      console.log(`Zone trouvée page ${zoneStartPage + 1}, scan pages ${from+1}-${to}`);

      const zoneB64 = await getPagesBatch(pdfDoc, from, to);
      const zonePrompt = `Ce document est une section d'un règlement PLU concernant la zone "${zone}" (${baseZone}).
Extrait INTÉGRALEMENT et mot pour mot TOUS les articles présents, notamment :
- Art. 1 ou ${baseZone} 1 : Destinations et usages autorisés/interdits/conditionnels
- Art. 2 : Mixité fonctionnelle, maintien d activités  
- Art. 3 ou ${baseZone} 3 : Implantation, reculs, gabarits, hauteurs
- Art. 4 : Aspect extérieur, architecture
- Art. 5 : Stationnement
- Art. 6 : Espaces verts, pleine terre
- Dispositions générales applicables à cette zone
Copie chaque article EN ENTIER avec son titre, numéro et contenu complet.`;

      const zoneExtract = await callHaiku(apiKey, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zoneB64 } },
        { type: 'text', text: zonePrompt }
      ]);
      zoneContent += '\n' + zoneExtract;
    } else if (zoneStartPage !== null) {
      // Zone dans les 20 premières pages — déjà dans toc20
      console.log('Zone dans les 20 premières pages');
    } else {
      // Page non trouvée — scan pages 1-60 en fallback
      console.log('Page non trouvée dans TOC, scan pages 1-100');
      const fallbackB64 = await getPagesBatch(pdfDoc, 0, 100);
      const ext = await callHaiku(apiKey, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fallbackB64 } },
        { type: 'text', text: `Extrait tous les articles de la zone "${zone}" ou "${baseZone}" et les dispositions générales. Copie le texte exact.` }
      ]);
      zoneContent += '\n' + ext;
    }

    if (!zoneContent || zoneContent.length < 100) {
      return res.status(400).json({ error: `Zone "${zone}" introuvable dans le document` });
    }

    // ── APPEL 3 : Analyse finale avec Sonnet ──
    const contextInfo = commune ? `Commune : ${commune}, adresse : ${address || ''}\nZone : ${zone}\n\n` : `Zone : ${zone}\n\n`;
    const result = await callSonnet(apiKey,
      contextInfo + `Articles extraits du règlement PLU :\n\n${zoneContent}\n\n---\n\n${prompt}`
    );

    console.log('✓ Analyse OK');
    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
