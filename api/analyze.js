// api/analyze.js
// Analyse le règlement PLU avec Claude
// Télécharge le PDF automatiquement depuis l'URL ou reçoit un base64

import Anthropic from '@anthropic-ai/sdk';

const PROMPTS = {
  destination: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU joint pour le cas suivant :
- Zone concernée : {ZONE}
- Opération : Changement de destination d'un local existant — bureaux → logements (habitation)
- Type de bien : Bâtiment existant (pas de construction neuve)

Réponds en structurant ta réponse ainsi :

## Verdict
Indique clairement : ✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé dans le règlement

## Synthèse
En 2-3 phrases, résume la situation pour quelqu'un qui doit prendre une décision rapidement.

## Articles applicables
Pour chaque article pertinent :
- Numéro et intitulé de l'article
- Page du document
- Extrait exact entre guillemets (copie mot pour mot)

## Conditions à respecter
Liste précise une par une.

## Autorisations requises
Permis de construire, déclaration préalable, etc.

## Points de vigilance
Ce qui pourrait bloquer ou compliquer l'opération.

## Notes complémentaires
Toute information utile non couverte ci-dessus.

Cite toujours l'extrait exact du règlement entre guillemets avec la page. Ne paraphrase pas.`,

  surelevation: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU joint pour le cas suivant :
- Zone concernée : {ZONE}
- Opération : Surélévation d'un bâtiment existant (ajout d'étages)
- Type de bien : Bâtiment existant

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé

## Synthèse
2-3 phrases décisionnelles.

## Articles applicables
Pour chaque article (hauteur max, gabarit, prospect) :
- Numéro, page, extrait exact entre guillemets

## Hauteur maximale autorisée
Précise la hauteur max en mètres et/ou en nombre de niveaux.

## Conditions à respecter
Gabarit, reculs, aspect extérieur, etc.

## Autorisations requises

## Points de vigilance

## Notes complémentaires

Cite toujours l'extrait exact avec la page.`,

  extension: `Tu es un expert en droit de l'urbanisme français, spécialisé dans les PLU d'Île-de-France.
Analyse le règlement du PLU joint pour le cas suivant :
- Zone concernée : {ZONE}
- Opération : Extension d'un bâtiment existant (agrandissement)
- Type de bien : Bâtiment existant

## Verdict
✅ Autorisé / ⚠️ Autorisé sous conditions / ❌ Interdit / ❓ Non précisé

## Synthèse
2-3 phrases décisionnelles.

## Articles applicables
Pour chaque article (emprise au sol, reculs, implantation) :
- Numéro, page, extrait exact entre guillemets

## Emprise au sol maximale
Coefficient ou surface max autorisée.

## Reculs et implantation
Distances min par rapport aux limites et à la voirie.

## Conditions à respecter

## Autorisations requises

## Points de vigilance

## Notes complémentaires

Cite toujours l'extrait exact avec la page.`
};

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
      const pdfRes = await fetch(pluUrl);
      if (!pdfRes.ok) throw new Error(`Impossible de télécharger le PLU (${pdfRes.status})`);
      const buffer = await pdfRes.arrayBuffer();
      pdfBase64 = Buffer.from(buffer).toString('base64');
    }

    // Construire le prompt
    const promptTemplate = PROMPTS[analysisType];
    if (!promptTemplate) return res.status(400).json({ error: 'Type d\'analyse invalide' });
    const prompt = promptTemplate.replace('{ZONE}', zone);

    // Appeler Claude
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }]
    });

    const result = message.content[0].text;

    return res.status(200).json({
      success: true,
      zone,
      analysisType,
      result
    });

  } catch (error) {
    console.error('Erreur analyse:', error);
    return res.status(500).json({ error: error.message });
  }
}
