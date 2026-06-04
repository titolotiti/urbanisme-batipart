import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const PROMPTS = {
  destination: `Tu es un expert en droit de l'urbanisme français.
Analyse les extraits du règlement PLU pour :
- Zone : {ZONE}
- Opération : Changement de destination — bureaux → logements
- Bâtiment existant

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé
## Synthèse (2-3 phrases décisionnelles)
## Articles applicables (numéro, page, extrait exact entre guillemets)
## Conditions à respecter
## Autorisations requises
## Points de vigilance
Cite toujours l'extrait exact entre guillemets avec la page.`,

  surelevation: `Tu es un expert en droit de l'urbanisme français.
Analyse les extraits du règlement PLU pour :
- Zone : {ZONE}
- Opération : Surélévation d'un bâtiment existant (ajout d'étages)

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé
## Synthèse (2-3 phrases décisionnelles)
## Articles applicables (numéro, page, extrait exact entre guillemets)
## Hauteur maximale autorisée
## Conditions à respecter
## Autorisations requises
## Points de vigilance
Cite toujours l'extrait exact entre guillemets avec la page.`,

  extension: `Tu es un expert en droit de l'urbanisme français.
Analyse les extraits du règlement PLU pour :
- Zone : {ZONE}
- Opération : Extension d'un bâtiment existant (agrandissement)

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé
## Synthèse (2-3 phrases décisionnelles)
## Articles applicables (numéro, page, extrait exact entre guillemets)
## Emprise au sol maximale
## Reculs et implantation
## Conditions à respecter
## Autorisations requises
## Points de vigilance
Cite toujours l'extrait exact entre guillemets avec la page.`
};

// Extrait les articles pertinents depuis le texte brut du PLU
function extractZoneText(fullText, zone) {
  const lines = fullText.split('\n');
  const relevant = [];
  let inZone = false;
  let inGeneral = false;
  const zoneUpper = zone.toUpperCase();
  const baseZone = zone.replace(/[0-9]/g, '').toUpperCase(); // ex: UBc → UB

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineUpper = line.toUpperCase();

    // Dispositions générales → toujours inclure
    if (lineUpper.includes('DISPOSITION') && lineUpper.includes('GÉNÉRAL')) {
      inGeneral = true;
    }
    // Début d'une autre zone → arrêt des dispositions générales
    if (inGeneral && lineUpper.match(/^ZONE\s+[A-Z]/) && !lineUpper.includes(baseZone)) {
      inGeneral = false;
    }

    // Début de la zone concernée
    if (lineUpper.includes(`ZONE ${zoneUpper}`) || lineUpper.includes(`ARTICLE ${zoneUpper}`)) {
      inZone = true;
    }
    // Début d'une autre zone → fin
    if (inZone && lineUpper.match(/^ZONE\s+[A-Z]/) && !lineUpper.includes(zoneUpper) && !lineUpper.includes(baseZone)) {
      inZone = false;
    }

    if (inZone || inGeneral) {
      relevant.push(line);
    }
  }

  // Si extraction vide, retourner le texte complet tronqué
  const result = relevant.join('\n').trim();
  if (result.length < 500) {
    return fullText.slice(0, 80000); // ~20k tokens max
  }
  return result.slice(0, 80000);
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

  try {
    // Récupérer le PDF en buffer
    let pdfBuffer;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      const pdfRes = await fetch(pluUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/pdf,*/*' }
      });
      if (!pdfRes.ok) throw new Error(`Impossible de télécharger le PLU (${pdfRes.status})`);
      pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    }

    // Extraire le texte côté serveur — aucune limite de pages !
    const pdfData = await pdfParse(pdfBuffer);
    const fullText = pdfData.text;
    console.log(`PDF: ${pdfData.numpages} pages, ${fullText.length} chars`);

    // Extraire uniquement les articles pertinents pour la zone
    const zoneText = extractZoneText(fullText, zone);
    console.log(`Zone text: ${zoneText.length} chars`);

    // Analyser avec Claude (texte seulement, pas de PDF)
    const client = new Anthropic({ apiKey });
    const prompt = PROMPTS[analysisType]?.replace('{ZONE}', zone);
    if (!prompt) return res.status(400).json({ error: "Type d'analyse invalide" });

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Voici les extraits du règlement PLU (zone ${zone}) :\n\n${zoneText}\n\n---\n\n${prompt}`
      }]
    });

    return res.status(200).json({
      success: true, zone, analysisType,
      result: message.content[0].text
    });

  } catch (error) {
    console.error('Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}
