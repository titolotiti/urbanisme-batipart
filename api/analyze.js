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

// Extrait uniquement les pages pertinentes pour la zone (scan intelligent)
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

    // Dispositions générales (20 premières pages)
    if (i <= 20 && (up.includes('DISPOSITION') || up.includes('DÉFINITION') || up.includes('TITRE'))) {
      generalText += `\n--- PAGE ${i} ---\n${pageText}`;
    }

    // Début de la zone
    if (!inZone && (up.includes(`ZONE ${zoneUp}`) || up.match(new RegExp(`\\bZONE\\s+${zoneUp}\\b`)))) {
      inZone = true; foundZone = true; pagesAfterZone = 0;
      console.log(`Zone ${zone} trouvée p.${i}`);
    }
    if (inZone) zoneText += `\n--- PAGE ${i} ---\n${pageText}`;

    // Fin de zone : autre zone détectée
    if (inZone && foundZone && zoneText.length > 1000) {
      const autres = [...up.matchAll(/ZONE\s+([A-Z]+\d*)/g)].map(m => m[1]);
      if (autres.find(z => z !== zoneUp && z !== baseZone)) {
        if (++pagesAfterZone >= 2) { console.log(`Fin zone p.${i}`); break; }
      } else pagesAfterZone = 0;
    }
    if (i >= 200 && !foundZone) break;
    if (i >= 150 && foundZone) break;
  }

  const out = (generalText + zoneText).slice(0, 80000);
  return out.length > 300 ? out : null;
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
    // ── Vérification taille ──
    const SMALL_LIMIT = 20 * 1024 * 1024; // 20MB = petit PDF
    let isSmall = !!pluBase64; // upload manuel → on tente direct
    if (!pluBase64 && pluUrl) {
      try {
        const head = await fetch(pluUrl, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        isSmall = size > 0 && size <= SMALL_LIMIT;
        console.log('Taille:', Math.round(size/1024/1024), 'MB →', isSmall ? 'petit' : 'grand');
      } catch(e) { isSmall = false; }
    }

    // ── Chemin A : Petit PDF ──
    // Télécharge une fois → essai direct Claude → si trop de pages, réutilise le buffer pour pdfjs
    if (isSmall) {
      let pdfB64 = pluBase64;
      let pdfBuf = null;
      if (!pdfB64) {
        const r = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        pdfBuf = Buffer.from(await r.arrayBuffer());
        pdfB64 = pdfBuf.toString('base64');
        console.log('Téléchargé:', Math.round(pdfBuf.length/1024), 'KB');
      } else {
        pdfBuf = Buffer.from(pdfB64, 'base64');
      }

      // Essai 1 : envoi PDF direct
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
            { type: 'text', text: prompt }
          ]}]})
        });
        const d = await r.json();
        if (r.ok) { console.log('✓ Direct OK'); return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text }); }
        if (!d.error?.message?.includes('100 PDF')) throw new Error(JSON.stringify(d.error));
        console.log('Trop de pages → extraction sur buffer déjà téléchargé');
      } catch(e) { if (!e.message?.includes('100 PDF')) throw e; }

      // Essai 2 : extraction pdfjs sur le buffer déjà en mémoire (pas de re-téléchargement)
      const pdf = await getDocument({ data: new Uint8Array(pdfBuf), isEvalSupported: false, useSystemFonts: true }).promise;
      console.log('pdfjs sur buffer:', pdf.numPages, 'pages');
      const zoneText = await extractZonePages(pdf, zone);
      if (!zoneText) throw new Error(`Zone "${zone}" introuvable dans le document`);
      const r2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content: `Extraits règlement zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}` }]})
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(JSON.stringify(d2.error));
      console.log('✓ Extraction buffer OK');
      return res.status(200).json({ success: true, zone, analysisType, result: d2.content[0].text });
    }

    // ── Chemin B : Grand PDF ──
    // pdfjs charge via URL avec Range requests — zero téléchargement complet
    console.log('Grand PDF → pdfjs Range requests');
    const pdf = await getDocument({
      url: pluUrl,
      httpHeaders: { 'User-Agent': 'Mozilla/5.0' },
      rangeChunkSize: 65536,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    console.log('pdfjs via URL:', pdf.numPages, 'pages');
    const zoneText = await extractZonePages(pdf, zone);
    if (!zoneText) throw new Error(`Zone "${zone}" introuvable dans le document`);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content: `Extraits règlement zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}` }]})
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d.error));
    console.log('✓ Grand PDF OK');
    return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
