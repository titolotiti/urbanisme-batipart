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

async function extractZone(source, zone) {
  const pdf = await getDocument(source).promise;
  const total = pdf.numPages;
  const zUp = zone.toUpperCase();
  const zBase = zone.replace(/\d+/g, '').toUpperCase();
  console.log(`${total} pages, zone ${zone}`);

  let general = '', zoneText = '', inZone = false, found = false, tail = 0;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const items = await page.getTextContent();
    const text = items.items.map(s => s.str).join(' ');
    const up = text.toUpperCase();

    if (i <= 20 && (up.includes('DISPOSITION') || up.includes('DÉFINITION')))
      general += `\n--- PAGE ${i} ---\n${text}`;

    if (!inZone && (up.includes(`ZONE ${zUp}`) || up.match(new RegExp(`\\bZONE\\s+${zUp}\\b`))))
      { inZone = true; found = true; console.log(`Trouvée p.${i}`); }

    if (inZone) zoneText += `\n--- PAGE ${i} ---\n${text}`;

    if (inZone && zoneText.length > 1000) {
      const other = [...up.matchAll(/ZONE\s+([A-Z]+\d*)/g)].map(m => m[1])
        .find(z => z !== zUp && z !== zBase);
      if (other) { if (++tail >= 2) { console.log(`Fin p.${i}`); break; } }
      else tail = 0;
    }
    if (!found && i >= 200) break;
    if (found && i >= 150) break;
  }

  return found ? (general + zoneText).slice(0, 80000) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone || !analysisType || (!pluUrl && !pluBase64))
    return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT.replace('{ZONE}', zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Source pdfjs — URL = Range requests (zéro download complet)
    // base64 = upload manuel de l'utilisateur
    const source = pluBase64
      ? { data: new Uint8Array(Buffer.from(pluBase64, 'base64')), isEvalSupported: false }
      : { url: pluUrl, httpHeaders: { 'User-Agent': 'Mozilla/5.0' },
          rangeChunkSize: 65536, disableAutoFetch: true, isEvalSupported: false };

    const zoneText = await extractZone(source, zone);
    if (!zoneText) return res.status(400).json({ error: `Zone "${zone}" introuvable dans le document` });
    console.log('Texte extrait:', zoneText.length, 'chars');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000,
        messages: [{ role: 'user', content: `Extraits règlement zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}` }] })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d.error));
    return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
