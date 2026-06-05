import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
GlobalWorkerOptions.workerSrc = join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');

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

// Scan page par page — extrait seulement les pages pertinentes
async function extractZonePages(pdf, zone) {
  const total = pdf.numPages;
  const zoneUp = zone.toUpperCase();
  const baseZone = zone.replace(/\d+/g, '').toUpperCase();
  let generalText = '';
  let zoneText = '';
  let inZone = false;
  let foundZone = false;
  let pagesAfterZone = 0;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(s => s.str).join(' ');
    const up = pageText.toUpperCase();

    // Capture dispositions générales (20 premières pages)
    if (i <= 20 && (up.includes('DISPOSITION') || up.includes('DÉFINITION') || up.includes('TITRE'))) {
      generalText += `\n--- PAGE ${i} ---\n${pageText}`;
    }

    // Début de la zone
    if (!inZone && (up.includes(`ZONE ${zoneUp}`) || up.match(new RegExp(`\\bZONE\\s+${zoneUp}\\b`)))) {
      inZone = true; foundZone = true; pagesAfterZone = 0;
      console.log(`Zone ${zone} trouvée p.${i}`);
    }
    if (inZone) { zoneText += `\n--- PAGE ${i} ---\n${pageText}`; }

    // Fin de zone : nouvelle zone différente détectée
    if (inZone && foundZone && zoneText.length > 1000) {
      const autres = [...up.matchAll(/ZONE\s+([A-Z]+\d*)/g)].map(m => m[1]);
      const autreZone = autres.find(z => z !== zoneUp && z !== baseZone && z.length >= 1);
      if (autreZone) {
        pagesAfterZone++;
        if (pagesAfterZone >= 2) { console.log(`Fin zone p.${i}`); break; }
      }
    }
    if (i >= 200 && !foundZone) break;
    if (i >= 150 && foundZone) break;
  }

  const result = (generalText + zoneText).slice(0, 80000);
  return result.length > 200 ? result : null;
}

async function callClaude(apiKey, content, prompt) {
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
  if (!zone || !analysisType || (!pluUrl && !pluBase64)) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT.replace('{ZONE}', zone).replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    let result = null;

    // ═══ ÉTAPE 1 : Envoi direct du PDF à Claude ═══
    // Rapide, précis — fonctionne pour les PDFs ≤ 100 pages
    try {
      let pdfB64 = pluBase64;
      if (!pdfB64 && pluUrl) {
        const r = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        pdfB64 = Buffer.from(await r.arrayBuffer()).toString('base64');
        console.log('PDF direct: ', Math.round(pdfB64.length * 0.75 / 1024), 'KB');
      }
      result = await callClaude(apiKey, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
        { type: 'text', text: prompt }
      ], prompt);
      console.log('✓ Méthode directe OK');
    } catch(e) {
      const msg = e.message || '';
      const needsFallback = msg.includes('100 PDF') || msg.includes('maximum') || msg.includes('size') || msg.includes('memory');
      if (!needsFallback) throw e;
      console.log('Direct échoué, fallback extraction:', msg.slice(0, 80));
    }

    // ═══ ÉTAPE 2 : Extraction ciblée via pdfjs (si étape 1 échoue) ═══
    // Scan page par page, extrait seulement les articles de la zone
    if (!result) {
      console.log('Extraction ciblée zone', zone);
      let pdf;
      if (pluBase64) {
        const buf = Buffer.from(pluBase64, 'base64');
        pdf = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
      } else {
        pdf = await getDocument({
          url: pluUrl,
          httpHeaders: { 'User-Agent': 'Mozilla/5.0' },
          rangeChunkSize: 65536,
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise;
      }
      console.log('PDF:', pdf.numPages, 'pages');
      const zoneText = await extractZonePages(pdf, zone);
      if (!zoneText) throw new Error('Articles de la zone introuvables dans le document');
      result = await callClaude(apiKey,
        `Extraits règlement PLU zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}`,
        prompt
      );
      console.log('✓ Méthode extraction OK');
    }

    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch(err) {
    console.error('Erreur finale:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
