import Anthropic from '@anthropic-ai/sdk';

const PROMPTS = {
  destination: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU ci-dessous pour :
- Zone : {ZONE}
- Opération : Changement de destination — bureaux → logements (habitation)
- Bâtiment existant

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé
## Synthèse (2-3 phrases décisionnelles)
## Articles applicables (numéro, page, extrait exact entre guillemets)
## Conditions à respecter
## Autorisations requises
## Points de vigilance
Cite toujours l'extrait exact entre guillemets avec la page.`,

  surelevation: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU ci-dessous pour :
- Zone : {ZONE}
- Opération : Surélévation d'un bâtiment existant (ajout d'étages)

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé
## Synthèse (2-3 phrases décisionnelles)
## Articles applicables (numéro, page, extrait exact entre guillemets)
## Hauteur maximale autorisée
## Conditions à respecter (gabarit, reculs, prospects)
## Autorisations requises
## Points de vigilance
Cite toujours l'extrait exact entre guillemets avec la page.`,

  extension: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU ci-dessous pour :
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

// Extrait le texte d'un PDF base64 via l'API Anthropic (text extraction)
async function extractTextFromPdf(pdfBase64, apiKey) {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extrais tout le texte de ce document PLU sous forme brute, sans reformatage. Conserve les numéros de pages, les titres d\'articles et les articles entiers.' }
      ]
    }]
  });
  return msg.content[0].text;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone) return res.status(400).json({ error: 'Zone PLU manquante' });
  if (!analysisType) return res.status(400).json({ error: 'Type d\'analyse manquant' });
  if (!pluUrl && !pluBase64) return res.status(400).json({ error: 'Document PLU manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  try {
    // Récupérer le PDF
    let pdfBase64 = pluBase64;
    if (!pdfBase64 && pluUrl) {
      const pdfRes = await fetch(pluUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/pdf,*/*',
        }
      });
      if (!pdfRes.ok) throw new Error(`Impossible de télécharger le PLU (${pdfRes.status})`);
      const buffer = await pdfRes.arrayBuffer();
      pdfBase64 = Buffer.from(buffer).toString('base64');
    }

    const promptTemplate = PROMPTS[analysisType];
    if (!promptTemplate) return res.status(400).json({ error: 'Type d\'analyse invalide' });
    const prompt = promptTemplate.replace('{ZONE}', zone);

    const client = new Anthropic({ apiKey });

    // Essai 1 : envoi direct du PDF (fonctionne si ≤ 100 pages)
    let result = null;
    try {
      const message = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      });
      result = message.content[0].text;
    } catch (pdfErr) {
      // Essai 2 : PDF trop long → extraire le texte d'abord
      if (pdfErr.message?.includes('100 PDF pages') || pdfErr.status === 400) {
        console.log('PDF trop long, extraction texte...');

        // Extraire uniquement la section de la zone concernée
        const extractMsg = await client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 6000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { 
                type: 'text', 
                text: `Ce document est un règlement PLU. Extrais UNIQUEMENT les articles qui concernent la zone "${zone}" (y compris les dispositions générales applicables à toutes les zones). Conserve les numéros d'articles, les titres et le texte intégral de chaque article. Inclus aussi les définitions générales si elles existent.`
              }
            ]
          }]
        });

        const extractedText = extractMsg.content[0].text;

        // Analyse sur le texte extrait
        const analyseMsg = await client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: `Voici les extraits du règlement PLU pour la zone ${zone} :\n\n${extractedText}\n\n---\n\n${prompt}`
          }]
        });
        result = analyseMsg.content[0].text;
      } else {
        throw pdfErr;
      }
    }

    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch (error) {
    console.error('Erreur analyse:', error);
    return res.status(500).json({ error: error.message });
  }
}
