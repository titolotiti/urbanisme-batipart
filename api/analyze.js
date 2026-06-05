const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération suivante : {OPERATION}

Réponds avec ces 3 sections. Pour chaque affirmation, cite immédiatement le passage exact du règlement.

---

## ① Faisabilité

**Verdict :** ✅ Possible / ⚠️ Possible sous conditions / ❌ Interdit / ❓ Non précisé

Explication en 2-3 phrases.

> *Page XX — Article YY :*
> "Passage complet du règlement."

---

## ② Logements sociaux

**Obligation :** [Oui X% / Non / Non mentionné]

> *Page XX — Article YY :*
> "Passage exact sur la mixité sociale."

---

## ③ Conditions et contraintes

**[Nom de la condition]**
Ce que ça implique.
> *Page XX — Article YY :*
> "Passage exact du règlement."

---

Règles : texte EXACT entre guillemets, indiquer page et article.`;

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

  try {
    let pdfB64 = pluBase64 || null;

    // Télécharge le PDF complet si pas de base64
    if (!pdfB64 && pluUrl) {
      console.log('Téléchargement:', pluUrl);
      const pdfR = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!pdfR.ok) throw new Error(`Erreur téléchargement (${pdfR.status})`);
      const buf = Buffer.from(await pdfR.arrayBuffer());
      pdfB64 = buf.toString('base64');
      console.log(`PDF: ${buf.length} bytes → b64: ${pdfB64.length} chars`);
    }

    // Appel Anthropic avec beta PDF header
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('Résultat:', response.ok ? 'OK' : data?.error?.message);
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
