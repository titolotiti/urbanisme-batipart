import Anthropic from '@anthropic-ai/sdk';

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

    const client = new Anthropic({ apiKey });
    const prompt = PROMPTS[analysisType]?.replace('{ZONE}', zone);
    if (!prompt) return res.status(400).json({ error: "Type d'analyse invalide" });

    // ÉTAPE 1 : Extraire les articles de la zone depuis le PDF
    // En passant par le texte, on contourne la limite de 100 pages
    const extractMsg = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
          },
          {
            type: 'text',
            text: `Ce document est un règlement PLU. Extrais UNIQUEMENT :
1. Les dispositions générales applicables à toutes les zones
2. Tous les articles qui concernent spécifiquement la zone "${zone}"

Conserve les numéros d'articles, les titres et le texte intégral. Indique le numéro de page pour chaque article.`
          }
        ]
      }]
    });

    const extractedText = extractMsg.content[0].text;

    // ÉTAPE 2 : Analyser le texte extrait
    const analyseMsg = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Voici les extraits du règlement PLU (zone ${zone}) :\n\n${extractedText}\n\n---\n\n${prompt}`
      }]
    });

    return res.status(200).json({
      success: true,
      zone,
      analysisType,
      result: analyseMsg.content[0].text
    });

  } catch (error) {
    console.error('Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}
