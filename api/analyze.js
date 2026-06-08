import { PDFDocument } from 'pdf-lib';

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération : {OPERATION}

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
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

async function extractPages(pdfDoc, from, to) {
  const total = pdfDoc.getPageCount();
  const end = Math.min(to, total);
  const sub = await PDFDocument.create();
  const pages = await sub.copyPages(pdfDoc, [...Array(end - from).keys()].map(i => i + from));
  pages.forEach(p => sub.addPage(p));
  return Buffer.from(await sub.save()).toString('base64');
}

async function callClaude(apiKey, content) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d.error));
  return d.content[0].text;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT.replace('{ZONE}', zone).replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Récupère le PDF
    let pdfBytes;
    if (pluBase64) {
      pdfBytes = Buffer.from(pluBase64, 'base64');
    } else {
      let url = pluUrl;
      try {
        const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        console.log('Taille:', Math.round(size/1024/1024), 'MB');
        if (size > 30 * 1024 * 1024) {
          const code = url.match(/DU_(\d+)\//)?.[1];
          url = (code && FALLBACK_URLS[code]) || url;
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

    // Variables pour le scan
    const baseZone = zone.replace(/[a-z]+$/, '').replace(/-[A-Z0-9-]+$/, '') || zone;
    const familleZone = baseZone.replace(/[0-9]+.*$/, '');
    const variants = [...new Set([zone, baseZone, familleZone, zone.toUpperCase(), baseZone.toUpperCase()])].filter(v => v).join('", "');

    const extractPrompt = `Ce document est une partie d'un règlement PLU.
Extrais INTÉGRALEMENT (mot pour mot) tout le texte concernant :
1. Les dispositions générales applicables à toutes les zones (définitions, règles communes)
2. La zone "${zone}" et variantes "${variants}" : cherche "ZONE ${zone}", "Zone ${baseZone}", "Article ${baseZone} 1" à "Article ${baseZone} 15", "Chapitre ${baseZone}", et toute section dont le titre contient "${zone}" ou "${baseZone}"
Inclus : destinations autorisées/interdites, hauteur, emprise, reculs, stationnement, logements sociaux.
Copie le texte exact avec numéros d'articles et pages.
Si rien de pertinent : réponds "RIEN_ICI".`;

    // Scan par tranches de 40 pages en parallèle (40p × ~2000 tok/p = 80K tokens, bien sous la limite)
    const CHUNK = 40;
    const CONCURRENCY = 5;
    const MAX_PAGES = 2000;
    const pagesToScan = Math.min(totalPages, MAX_PAGES);

    const allChunks = [];
    for (let from = 0; from < pagesToScan; from += CHUNK) allChunks.push(from);

    const chunkResults = [];
    for (let i = 0; i < allChunks.length; i += CONCURRENCY) {
      const batch = allChunks.slice(i, i + CONCURRENCY);
      const end = Math.min(batch[batch.length-1] + CHUNK, pagesToScan);
      console.log(`Scan pages ${batch[0]+1}-${end}...`);

      const results = await Promise.all(batch.map(async (from) => {
        const b64 = await extractPages(pdfDoc, from, from + CHUNK);
        return callClaude(apiKey, [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: extractPrompt }
        ]);
      }));
      chunkResults.push(...results);
    }

    const zoneContent = chunkResults.filter(r => !r.includes('RIEN_ICI')).join('\n');
    if (!zoneContent) return res.status(400).json({ error: `Zone "${zone}" introuvable dans le document` });
    console.log('Contenu extrait:', zoneContent.length, 'chars');

    // Analyse finale
    const result = await callClaude(apiKey,
      `Articles du règlement PLU zone ${zone} :\n\n${zoneContent}\n\n---\n\n${prompt}`
    );

    console.log('✓ Analyse OK');
    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
