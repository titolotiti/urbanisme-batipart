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

// Taille max à envoyer à Anthropic (en bytes avant base64)
const MAX_PDF_BYTES = 2 * 1024 * 1024; // 2MB → ~2.7MB base64

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
    let usedUrl = false;

    // Si pas de base64 : essaie d'abord l'URL directe (plus léger)
    // Si ça échoue (trop grand) : télécharge avec streaming limité
    if (!pdfB64 && pluUrl) {
      console.log('Tentative URL directe:', pluUrl);

      // Essai 1 : URL directe (0 download côté Vercel)
      const testResp = await fetch('https://api.anthropic.com/v1/messages', {
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
              { type: 'document', source: { type: 'url', url: pluUrl } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });
      const testData = await testResp.json();
      
      if (testResp.ok) {
        return res.status(200).json({
          success: true, zone, analysisType,
          result: testData.content[0].text
        });
      }
      
      // Si erreur taille : télécharge avec streaming limité
      const errMsg = testData?.error?.message || '';
      console.log('URL directe échouée:', errMsg);
      
      if (errMsg.includes('size') || errMsg.includes('pages') || testResp.status === 400) {
        console.log('Streaming limité à', MAX_PDF_BYTES, 'bytes...');
        const pdfR = await fetch(pluUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Range': `bytes=0-${MAX_PDF_BYTES}` }
        });
        const reader = pdfR.body.getReader();
        const chunks = [];
        let total = 0;
        try {
          while (total < MAX_PDF_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            const space = MAX_PDF_BYTES - total;
            chunks.push(value.length > space ? value.slice(0, space) : value);
            total += Math.min(value.length, space);
            if (total >= MAX_PDF_BYTES) break;
          }
        } finally { reader.cancel().catch(() => {}); }
        
        const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
        pdfB64 = buf.toString('base64');
        console.log('Stream:', buf.length, 'bytes → b64:', pdfB64.length, 'chars');
      } else {
        throw new Error(errMsg || 'Erreur API');
      }
    }

    // Envoi base64
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
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('Final result:', response.ok ? 'OK' : data?.error?.message);
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
