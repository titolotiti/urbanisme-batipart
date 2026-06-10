import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PROMPT = `Tu es un expert en droit de l'urbanisme français.
Voici les extraits du règlement PLU pour la zone {ZONE}{COMMUNE}.
Analyse pour l'opération : {OPERATION}

IMPORTANT : Dans un PLUi, les règles sont définies par zone (pas par commune) — elles s'appliquent identiquement à toute parcelle de cette zone, quelle que soit la commune. Analyse les règles de la zone indiquée sans filtrer par commune.
Si tu mentionnes un plan graphique, un plan de zonage ou un document cartographique, inclus TOUJOURS le lien de téléchargement fourni ci-dessus directement dans ta réponse sous la forme : [↗ Télécharger le plan graphique]({URL})

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

Texte EXACT entre guillemets. Toujours indiquer page et article.

IMPORTANT : Ne commence pas par un avertissement préalable. Lance-toi directement dans l'analyse.
À la toute fin seulement, ajoute cette ligne unique :

À la toute fin, ajoute une seule ligne :

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

const FALLBACK_URLS = {
  '200057867_zones': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
  '200057867_general': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/200057867_4-1-1_Partie1_Definitions_et_dispositions_generales.pdf',
};

// Extrait le texte d'un buffer PDF
async function extractText(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

// Extrait la section pertinente pour la zone depuis le texte complet
function extractZoneText(fullText, zone) {
  const zoneUp = zone.toUpperCase();
  const baseZone = zone.replace(/[a-z]+$/, '').replace(/-[A-Z0-9-]+$/, '') || zone;
  const baseUp = baseZone.toUpperCase();
  const familleUp = baseUp.replace(/[0-9]+.*$/, '');

  const lines = fullText.split('\n');
  const result = [];
  let capturing = false;
  let generalLines = [];
  let inGeneral = false;
  let zoneFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const up = line.toUpperCase();

    // Capture dispositions générales (début du document)
    if (!zoneFound && (up.includes('DISPOSITION') || up.includes('DÉFINITION') || up.includes('TITRE I') || up.includes('TITRE 1'))) {
      inGeneral = true;
    }
    if (inGeneral && !zoneFound) generalLines.push(line);

    // Détecte début de la zone
    const isZoneStart = up.includes(`ZONE ${zoneUp}`) || up.includes(`ZONE ${baseUp}`) ||
      up.match(new RegExp(`\\bZONE\\s+${zoneUp}\\b`)) ||
      up.match(new RegExp(`^${baseUp}\\s*\\d`)) ||
      (up.includes(baseUp) && up.includes('ARTICLE'));

    if (isZoneStart && !capturing) {
      capturing = true;
      zoneFound = true;
      inGeneral = false;
    }

    if (capturing) result.push(line);

    // Détecte fin de zone (autre zone commence)
    if (capturing && result.length > 50) {
      const otherZone = up.match(/^ZONE\s+([A-Z]+[0-9]*[a-z]*)\b/);
      if (otherZone && otherZone[1] !== zoneUp && otherZone[1] !== baseUp) {
        break;
      }
    }
  }

  const zoneSection = result.join('\n');
  const generalSection = generalLines.slice(0, 200).join('\n'); // max 200 lignes de dispositions générales

  // Si zone non trouvée, retourne tout le texte tronqué
  if (!zoneFound) {
    console.log('Zone non trouvée par recherche, envoi texte complet tronqué');
    return fullText.slice(0, 120000);
  }

  const combined = generalSection + '\n\n--- ZONE ' + zone + ' ---\n\n' + zoneSection;
  return combined.slice(0, 120000);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64, commune, address, zonageUrl, planUrls } = req.body;
  console.log('Params:', { zone, commune, address: address?.slice(0, 40) });

  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const communeInfo = commune ? `\nCommune : ${commune}${address ? ' — ' + address : ''}` : '';
  const plansInfo = (planUrls && planUrls.length)
    ? '\nPlans graphiques disponibles :\n' + planUrls.map(p => `- Plan ${p.n} : ${p.url}`).join('\n')
    : (zonageUrl ? `\nPlan graphique téléchargeable : ${zonageUrl}` : '');
  const planInfo = plansInfo;
  const prompt = PROMPT
    .replace('{ZONE}', zone)
    .replace('{COMMUNE}', communeInfo + planInfo)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Détermine l'URL à utiliser
    let url = pluUrl;
    if (!pluBase64 && url) {
      const code = url.match(/DU_(\d+)\//)?.[1];
      try {
        const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const size = parseInt(head.headers.get('content-length') || '0');
        console.log('Taille:', Math.round(size / 1024 / 1024), 'MB');
        if (size === 0 || size > 30 * 1024 * 1024) {
          if (code && FALLBACK_URLS[code + '_zones']) {
            url = FALLBACK_URLS[code + '_zones'];
            console.log('Fallback zones utilisé');
          }
        }
      } catch(e) {
        const code = url.match(/DU_(\d+)\//)?.[1];
        if (code && FALLBACK_URLS[code + '_zones']) url = FALLBACK_URLS[code + '_zones'];
      }
    }

    // Télécharge le PDF
    let pdfBuffer;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Téléchargement échoué (' + r.status + ')');
      pdfBuffer = Buffer.from(await r.arrayBuffer());
      console.log('PDF:', Math.round(pdfBuffer.length / 1024 / 1024), 'MB');
    }

    // Extrait le texte complet avec pdf-parse
    let fullText = await extractText(pdfBuffer);
    console.log('Texte extrait:', fullText.length, 'chars');

    // Pour Plaine Commune : ajoute aussi les dispositions générales
    const urlCode = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
    if (urlCode && FALLBACK_URLS[urlCode + '_general']) {
      try {
        const gr = await fetch(FALLBACK_URLS[urlCode + '_general'], { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (gr.ok) {
          const gb = Buffer.from(await gr.arrayBuffer());
          const generalText = await extractText(gb);
          fullText = generalText.slice(0, 40000) + '\n\n' + fullText;
          console.log('Dispositions générales ajoutées');
        }
      } catch(e) {}
    }

    // Extraction intelligente de la section de zone
    const baseZone = zone.replace(/[a-z]+$/, '').replace(/-[A-Z0-9-]+$/, '') || zone;

    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function extractZoneSection(text, z, base) {
      try {
        const zE = escRe(z), bE = escRe(base);
        const patterns = [
          new RegExp('ZONE\\s+' + zE + '\\b', 'i'),
          new RegExp('ZONE\\s+' + bE + '\\b', 'i'),
          new RegExp('Article\\s+' + bE + '\\s+1\\b', 'i'),
          new RegExp('^' + bE + '\\s*[-–—:]', 'im'),
        ];
        let start = -1;
        for (const p of patterns) {
          try { const m = text.search(p); if (m > -1 && (start === -1 || m < start)) start = m; } catch(e) {}
        }
        if (start === -1) return null;
        start = Math.max(0, start - 300);
        try {
          const after = text.slice(start + 500);
          const endM = after.search(new RegExp('\\n(ZONE\\s+[A-Z][A-Z0-9-]+)', 'i'));
          const end = endM > -1 ? start + 500 + endM : Math.min(start + 80000, text.length);
          return text.slice(start, end);
        } catch(e) { return text.slice(start, Math.min(start + 80000, text.length)); }
      } catch(e) { return null; }
    }

    const generalText = fullText.slice(0, 20000);
    const zoneSection = extractZoneSection(fullText, zone, baseZone);

    let sendText;
    if (zoneSection) {
      sendText = generalText + '\n\n--- ZONE ' + zone + ' ---\n\n' + zoneSection;
      console.log('Zone trouvée:', zoneSection.length, 'chars');
    } else {
      const third = Math.floor(fullText.length / 3);
      sendText = fullText.slice(0, 50000) + '\n...\n' + fullText.slice(third, third + 50000) + '\n...\n' + fullText.slice(-30000);
      console.log('Zone non trouvée, découpage 3 parties');
    }
    console.log('Texte envoyé:', sendText.length, 'chars');

    const fullPrompt = 'Voici les extraits du règlement PLU pour la zone "' + zone + '".\n\n' + sendText + '\n\n---\n\n' + prompt;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d.error));

    console.log('✓ Analyse OK');
    return res.status(200).json({ success: true, zone, analysisType, result: d.content[0].text });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
