import { PDFDocument } from 'pdf-lib';

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

const FALLBACK_URLS = {
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

// Extrait une tranche de pages d'un PDF (pages 0-indexées)
async function extractPages(pdfBytes, from, to) {
  const src = await PDFDocument.load(pdfBytes);
  const total = src.getPageCount();
  const end = Math.min(to, total);
  const dst = await PDFDocument.create();
  const pages = await dst.copyPages(src, [...Array(end - from).keys()].map(i => i + from));
  pages.forEach(p => dst.addPage(p));
  return { bytes: await dst.save(), total, end };
}

async function callClaude(apiKey, pdfB64, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-5', max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
        { type: 'text', text: prompt }
      ]}]
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d.error));
  return d.content[0].text;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT.replace('{ZONE}', zone).replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Récupère le PDF (avec fallback URL si trop grand)
    let pdfBytes;
    if (pluBase64) {
      pdfBytes = Buffer.from(pluBase64, 'base64');
    } else {
      let url = pluUrl;
      // Vérifie taille — si trop grand, utilise URL allégée si disponible
      try {
        const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        console.log('Taille:', Math.round(size/1024/1024), 'MB');
        if (size > 30 * 1024 * 1024) {
          const code = url.match(/DU_(\d+)\//)?.[1];
          url = (code && FALLBACK_URLS[code]) || url;
          console.log('URL fallback:', url !== pluUrl ? 'oui' : 'non');
        }
      } catch(e) {}

      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Téléchargement échoué (' + r.status + ')');
      pdfBytes = Buffer.from(await r.arrayBuffer());
      console.log('PDF:', Math.round(pdfBytes.length/1024/1024), 'MB');
    }

    // Charge le PDF avec pdf-lib pour connaître le nombre de pages
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    console.log('Pages total:', totalPages);

    // Si ≤ 100 pages → envoi direct
    if (totalPages <= 100) {
      const result = await callClaude(apiKey, Buffer.from(pdfBytes).toString('base64'), prompt);
      console.log('✓ Direct (≤100 pages)');
      return res.status(200).json({ success: true, zone, analysisType, result });
    }

    // Si > 100 pages → scan par tranches de 100, cherche la zone
    const CHUNK = 100;
    const extractPrompt = `Ce document est une partie d'un règlement PLU. 
Extrait UNIQUEMENT le texte des articles concernant la zone "${zone}" (y compris les dispositions générales si présentes).
Si la zone "${zone}" n'est pas dans ce fragment, réponds exactement : "ZONE_NOT_FOUND"
Sinon, retourne le texte complet des articles trouvés avec numéros de pages.`;

    let zoneContent = '';
    for (let from = 0; from < totalPages; from += CHUNK) {
      const { bytes, end } = await extractPages(pdfBytes, from, from + CHUNK);
      const chunkB64 = Buffer.from(bytes).toString('base64');
      console.log(`Scan pages ${from+1}-${end}...`);

      const extract = await callClaude(apiKey, chunkB64, extractPrompt);
      if (!extract.includes('ZONE_NOT_FOUND')) {
        zoneContent += extract;
        console.log(`Zone ${zone} trouvée pages ${from+1}-${end}`);
        // Continue sur la tranche suivante pour capturer la fin de la zone
        if (from + CHUNK < totalPages) {
          const { bytes: bytes2 } = await extractPages(pdfBytes, from + CHUNK, from + CHUNK + 50);
          const b2 = Buffer.from(bytes2).toString('base64');
          const ext2 = await callClaude(apiKey, b2, extractPrompt);
          if (!ext2.includes('ZONE_NOT_FOUND')) zoneContent += '\n' + ext2;
        }
        break;
      }
    }

    if (!zoneContent) return res.status(400).json({ error: `Zone "${zone}" introuvable dans le document` });

    // Analyse finale sur le contenu extrait
    const analysisPrompt = `Voici les articles du règlement PLU pour la zone ${zone} :\n\n${zoneContent}\n\n---\n\n${prompt}`;
    const r2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content: analysisPrompt }] })
    });
    const d2 = await r2.json();
    if (!r2.ok) throw new Error(JSON.stringify(d2.error));

    console.log('✓ Scan par tranches OK');
    return res.status(200).json({ success: true, zone, analysisType, result: d2.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
