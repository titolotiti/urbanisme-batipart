import Anthropic from '@anthropic-ai/sdk';

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse les extraits du règlement PLU (zone {ZONE}) pour l'opération suivante : {OPERATION}

Réponds avec ces 3 sections. Pour chaque affirmation, cite immédiatement le passage exact du règlement qui la justifie — suffisamment long pour être compris seul.

---

## ① Faisabilité

**Verdict :** ✅ Possible / ⚠️ Possible sous conditions / ❌ Interdit / ❓ Non précisé

Explication en 2-3 phrases claires.

> *Page XX — Article YY :*
> "Passage complet du règlement justifiant ce verdict."

---

## ② Logements sociaux

**Obligation :** [Oui X% / Non / Non mentionné]

Explique la règle en une phrase.

> *Page XX — Article YY :*
> "Passage exact et complet sur les obligations de mixité sociale. Si rien : indiquer explicitement qu'aucune disposition n'a été trouvée."

---

## ③ Conditions et contraintes

Pour chaque condition :

**[Nom de la condition]**
Ce que ça implique concrètement.
> *Page XX — Article YY :*
> "Passage exact et suffisamment long du règlement définissant cette condition."

---

Règles : texte EXACT entre guillemets, jamais de paraphrase. Indiquer page et article systématiquement.`;

const OPERATIONS = {
  destination: "Changement de destination — transformation de bureaux en logements sur bâtiment existant",
  surelevation: "Surélévation d'un bâtiment existant — ajout d'étages (hauteur maximale, gabarit, prospects)",
  extension: "Extension d'un bâtiment existant — agrandissement (emprise au sol, reculs, implantation)"
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
    // Récupérer le PDF en base64
    let pdfB64 = pluBase64;
    if (!pdfB64 && pluUrl) {
      const r = await fetch(pluUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/pdf,*/*' }
      });
      if (!r.ok) throw new Error(`Impossible de télécharger le PLU (${r.status})`);
      pdfB64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    }

    const client = new Anthropic({ apiKey });
    const prompt = BASE_PROMPT
      .replace('{ZONE}', zone)
      .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

    // ÉTAPE 1 : Claude extrait les articles de la zone (contourne la limite 100 pages)
    const extractMsg = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
          { type: 'text', text: `Extrais UNIQUEMENT les articles concernant la zone "${zone}" et les dispositions générales applicables à toutes les zones. Conserve numéros d'articles, titres, texte intégral et numéros de pages.` }
        ]
      }]
    });

    const extracted = extractMsg.content[0].text;

    // ÉTAPE 2 : Analyse sur le texte extrait
    const analyseMsg = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Extraits du règlement PLU zone ${zone} :\n\n${extracted}\n\n---\n\n${prompt}`
      }]
    });

    return res.status(200).json({
      success: true, zone, analysisType,
      result: analyseMsg.content[0].text
    });

  } catch(err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: err.message });
  }
}
