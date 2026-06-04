const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération suivante : {OPERATION}

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
> "Passage exact et complet sur les obligations de mixité sociale."

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

  const prompt = BASE_PROMPT
    .replace('{ZONE}', zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  // Source du document — URL directe (Claude fetch lui-même) ou base64 (upload manuel)
  const docSource = pluBase64
    ? { type: 'base64', media_type: 'application/pdf', data: pluBase64 }
    : { type: 'url', url: pluUrl };

  try {
    // Appel direct à l'API Anthropic sans SDK — évite tout téléchargement sur Vercel
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
          content: [
            { type: 'document', source: docSource },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data.error));

    return res.status(200).json({
      success: true, zone, analysisType,
      result: data.content[0].text
    });

  } catch(err) {
    console.error('Erreur analyze:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
