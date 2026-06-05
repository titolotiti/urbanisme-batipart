import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Configure le worker pour Node.js/Vercel
GlobalWorkerOptions.workerSrc = join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération suivante : {OPERATION}

Réponds avec ces 3 sections. Pour chaque affirmation, cite le passage exact du règlement.

## ① Faisabilité
**Verdict :** ✅ Possible / ⚠️ Possible sous conditions / ❌ Interdit / ❓ Non précisé
Explication en 2-3 phrases.
> *Page XX — Article YY :*
> "Passage complet du règlement."

## ② Logements sociaux
**Obligation :** [Oui X% / Non / Non mentionné]
> *Page XX — Article YY :*
> "Passage exact sur la mixité sociale."

## ③ Conditions et contraintes
**[Nom de la condition]**
Ce que ça implique.
> *Page XX — Article YY :*
> "Passage exact du règlement."

Règles : texte EXACT entre guillemets, indiquer page et article.`;

const OPERATIONS = {
  destination: "Changement de destination — transformation de bureaux en logements sur bâtiment existant",
  surelevation: "Surélévation d'un bâtiment existant — ajout d'étages (hauteur maximale, gabarit, prospects)",
  extension: "Extension d'un bâtiment existant — agrandissement (emprise au sol, reculs, implantation)"
};

// Extrait le texte d'un PDF buffer via pdfjs-dist
async function extractPdfText(pdfBuffer) {
  const data = new Uint8Array(pdfBuffer);
  const pdf = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  console.log('PDF pages:', pdf.numPages);
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `\n--- PAGE ${i} ---\n${pageText}`;
  }
  return fullText;
}

// Extrait uniquement la section de la zone dans le texte complet
function extractZoneSection(fullText, zone) {
  const lines = fullText.split('\n');
  const zoneUpper = zone.toUpperCase();
  const baseZone = zone.replace(/\d/g, '').toUpperCase();
  
  let result = [];
  let capturing = false;
  let generalSection = [];
  let inGeneral = false;

  for (const line of lines) {
    const lineUp = line.toUpperCase();
    
    // Dispositions générales
    if (lineUp.includes('DISPOSITION') && lineUp.includes('GÉNÉRAL')) inGeneral = true;
    if (inGeneral && lineUp.match(/ZONE\s+[A-Z]/) && !lineUp.includes(baseZone)) inGeneral = false;
    if (inGeneral) generalSection.push(line);

    // Zone spécifique
    if (lineUp.includes(`ZONE ${zoneUpper}`) || lineUp.match(new RegExp(`\\bZONE\\s+${zoneUpper}\\b`))) {
      capturing = true;
    }
    if (capturing && lineUp.match(/ZONE\s+[A-Z]/) && !lineUp.includes(zoneUpper) && !lineUp.includes(baseZone)) {
      capturing = false;
    }
    if (capturing) result.push(line);
  }

  const extracted = [...new Set([...generalSection, ...result])].join('\n');
  if (extracted.length < 500) return fullText.slice(0, 60000);
  return extracted.slice(0, 60000);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone) return res.status(400).json({ error: 'Zone PLU manquante' });
  if (!analysisType) return res.status(400).json({ error: "Type d'analyse manquant" });
  if (!pluUrl && !pluBase64) return res.status(400).json({ error: 'Document PLU manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT
    .replace('{ZONE}', zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Récupère le PDF
    let pdfBuffer;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      const pdfR = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!pdfR.ok) throw new Error(`Erreur téléchargement (${pdfR.status})`);
      pdfBuffer = Buffer.from(await pdfR.arrayBuffer());
      console.log('PDF:', pdfBuffer.length, 'bytes');
    }

    // Extrait le texte avec pdfjs-dist (pas de limite de pages)
    const fullText = await extractPdfText(pdfBuffer);
    console.log('Texte total:', fullText.length, 'chars');

    // Extrait uniquement la section de la zone
    const zoneText = extractZoneSection(fullText, zone);
    console.log('Texte zone:', zoneText.length, 'chars');

    // Analyse avec Claude (texte = pas de limite de pages)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Voici les extraits du règlement PLU pour la zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}`
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data.error));
    
    return res.status(200).json({ success: true, zone, analysisType, result: data.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
