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

async function extractZoneFromPdf(pdfBuf, zone) {
  const pdf = await getDocument({
    data: new Uint8Array(pdfBuf),
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  const total = pdf.numPages;
  const zoneUp = zone.toUpperCase();
  const baseZone = zone.replace(/\d+/g, '').toUpperCase();
  console.log(`pdfjs: ${total} pages, cherche zone ${zone}`);

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

    // Garde les dispositions générales (20 premières pages)
    if (i <= 20 && (up.includes('DISPOSITION') || up.includes('DÉFINITION') || up.includes('TITRE I'))) {
      generalText += `\n--- PAGE ${i} ---\n${pageText}`;
    }

    // Début zone
    if (!inZone && (up.includes(`ZONE ${zoneUp}`) || up.match(new RegExp(`\\bZONE\\s+${zoneUp}\\b`)))) {
      inZone = true;
      foundZone = true;
      console.log(`Zone ${zone} trouvée page ${i}`);
    }
    if (inZone) zoneText += `\n--- PAGE ${i} ---\n${pageText}`;

    // Fin zone : autre zone détectée
    if (inZone && zoneText.length > 1000) {
      const autres = [...up.matchAll(/ZONE\s+([A-Z]+\d*)/g)].map(m => m[1]);
      if (autres.find(z => z !== zoneUp && z !== baseZone)) {
        if (++pagesAfterZone >= 2) { console.log(`Fin zone page ${i}`); break; }
      } else pagesAfterZone = 0;
    }

    if (i >= 200 && !foundZone) break;
    if (i >= 150 && foundZone) break;
  }

  return (generalText + zoneText).slice(0, 80000) || null;
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
    // 1. Récupère le PDF (téléchargement ou base64)
    let pdfBuf;
    if (pluBase64) {
      pdfBuf = Buffer.from(pluBase64, 'base64');
    } else {
      const r = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`Téléchargement échoué (${r.status})`);
      pdfBuf = Buffer.from(await r.arrayBuffer());
      console.log('PDF téléchargé:', Math.round(pdfBuf.length / 1024 / 1024), 'MB');
    }

    // 2. pdfjs extrait les articles de la zone
    const zoneText = await extractZoneFromPdf(pdfBuf, zone);
    if (!zoneText) throw new Error(`Zone "${zone}" introuvable dans le document`);
    console.log('Texte extrait:', zoneText.length, 'chars');

    // 3. Claude analyse le texte
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: `Extraits règlement PLU zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}` }]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d.error));

    return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
