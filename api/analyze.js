import { PDFDocument } from 'pdf-lib';

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Tu vas recevoir un extrait d'un règlement PLU. 

ÉTAPE 1 — Trouve et extrais tous les articles concernant :
- La zone "${ZONE}" et ses variantes (ex: si zone=UDa, cherche aussi UD, UD 1, UD 2... ; si zone=UBc, cherche aussi UB ; si zone=UMD, cherche aussi UM)
- Les dispositions générales applicables à toutes les zones

ÉTAPE 2 — Avec ces articles, analyse pour l'opération : {OPERATION}

## ① Faisabilité
**Verdict :** ✅ Possible / ⚠️ Sous conditions / ❌ Interdit / ❓ Non précisé dans les articles trouvés
Explication 2-3 phrases basée sur les articles trouvés.
> *Page XX — Article YY :* "Passage exact."

## ② Logements sociaux
**Obligation :** [Oui X% / Non / Non mentionné dans les articles trouvés]
> *Page XX — Article YY :* "Passage exact."

## ③ Conditions et contraintes
**[Condition]** — Ce que ça implique.
> *Page XX — Article YY :* "Passage exact."

Règles : cite toujours le texte EXACT entre guillemets avec page et article.`;

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

const FALLBACK_URLS = {
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

async function callOpus(apiKey, content) {
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

  const prompt = BASE_PROMPT
    .replace(/\$\{ZONE\}/g, zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

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

    // Extrait max 100 pages centrées sur là où la zone est probablement
    // Pour ≤100 pages : envoie tout
    // Pour >100 pages : envoie pages 1-100 (contient presque toujours les dispositions + zone)
    const pagesToSend = Math.min(totalPages, 100);
    let subPdfB64;

    if (totalPages <= 100) {
      subPdfB64 = Buffer.from(pdfBytes).toString('base64');
    } else {
      const sub = await PDFDocument.create();
      const pages = await sub.copyPages(pdfDoc, [...Array(pagesToSend).keys()]);
      pages.forEach(p => sub.addPage(p));
      subPdfB64 = Buffer.from(await sub.save()).toString('base64');
      console.log('Extrait pages 1-' + pagesToSend);
    }

    // Un seul appel Opus : extrait la zone ET analyse
    const result = await callOpus(apiKey, [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: subPdfB64 } },
      { type: 'text', text: prompt }
    ]);

    console.log('✓ OK');
    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
