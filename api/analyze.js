const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération : {OPERATION}

## ① Faisabilité
**Verdict :** ✅ Possible / ⚠️ Sous conditions / ❌ Interdit / ❓ Non précisé
Explication 2-3 phrases.
> *Page XX — Article YY :* "Passage exact."

## ② Logements sociaux
**Obligation :** [Oui X% / Non / Non mentionné]
> *Page XX — Article YY :* "Passage exact."

## ③ Conditions et contraintes
**[Condition]** — Ce que ça implique.
> *Page XX — Article YY :* "Passage exact."

Texte EXACT entre guillemets. Toujours indiquer page et article.`;

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

// Fichiers allégés pour les grands PLUi — utilisés si règlement principal trop lourd
const FALLBACK_URLS = {
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone || !analysisType || (!pluUrl && !pluBase64))
    return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT
    .replace('{ZONE}', zone)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  // Détermine l'URL à utiliser
  // Si PLU trop lourd → cherche un fichier allégé dans FALLBACK_URLS
  async function getUrl(url) {
    if (!url) return url;
    try {
      const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const size = parseInt(head.headers.get('content-length') || '0');
      console.log('Taille:', Math.round(size/1024/1024), 'MB');
      if (size > 30 * 1024 * 1024) {
        const code = url.match(/DU_(\d+)\//)?.[1];
        const fallback = code && FALLBACK_URLS[code];
        if (fallback) {
          console.log('Fallback URL:', fallback);
          return fallback;
        }
        return null; // trop grand, pas de fallback
      }
    } catch(e) {}
    return url;
  }

  try {
    const effectiveUrl = pluBase64 ? null : await getUrl(pluUrl);

    if (!pluBase64 && !effectiveUrl) {
      return res.status(400).json({
        error: `Ce règlement PLU est trop volumineux pour être analysé automatiquement.\n\nTéléchargez le règlement via le bouton "Télécharger" dans l'interface, puis uploadez uniquement la section de la zone "${zone}" via "Remplacer par un autre PLU".`
      });
    }

    // Télécharge le PDF
    let pdfB64 = pluBase64;
    if (!pdfB64) {
      const r = await fetch(effectiveUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Téléchargement échoué (' + r.status + ')');
      pdfB64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      console.log('PDF prêt:', Math.round(pdfB64.length * 0.75 / 1024 / 1024), 'MB');
    }

    // Analyse Claude
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d.error));

    return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
