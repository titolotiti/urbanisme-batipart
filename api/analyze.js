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
    let pdfBuf = null;

    if (!pluBase64 && pluUrl) {
      // Vérifie taille avant download
      try {
        const head = await fetch(pluUrl, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        console.log('PDF size:', size, 'bytes =', Math.round(size/1024/1024), 'MB');
        if (size > 200 * 1024 * 1024) {
          return res.status(400).json({ error: `Règlement trop volumineux (${Math.round(size/1024/1024)}MB). Uploadez manuellement la section zone ${zone}.` });
        }
      } catch(e) {}

      const pdfR = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!pdfR.ok) throw new Error(`Erreur téléchargement (${pdfR.status})`);
      pdfBuf = Buffer.from(await pdfR.arrayBuffer());
      console.log('PDF téléchargé:', pdfBuf.length, 'bytes');
    } else if (pluBase64) {
      pdfBuf = Buffer.from(pluBase64, 'base64');
    }

    // ── Étape 1 : Upload via Files API (bypass limite 100 pages) ──
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'reglement.pdf');
    formData.append('purpose', 'assistants');

    const uploadResp = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
      body: formData
    });
    const uploadData = await uploadResp.json();
    console.log('Upload result:', JSON.stringify(uploadData).slice(0, 200));
    if (!uploadResp.ok) throw new Error('Upload échoué: ' + JSON.stringify(uploadData.error));

    const fileId = uploadData.id;
    console.log('File ID:', fileId);

    // ── Étape 2 : Analyse avec file_id ──
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'file', file_id: fileId } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('Analyse:', response.ok ? 'OK' : data?.error?.message);

    // Supprime le fichier uploadé
    fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' }
    }).catch(() => {});

    if (!response.ok) throw new Error(JSON.stringify(data.error));
    return res.status(200).json({ success: true, zone, analysisType, result: data.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
