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

IMPORTANT : Ne commence pas par un avertissement préalable. Lance-toi directement dans l'analyse.`;

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
    ? '\nPlans graphiques disponibles (liens de téléchargement) — le nom indiqué est le titre RÉEL du plan :\n' + 
      planUrls.map(p => `- ${p.nom} : ${p.url}`).join('\n') +
      '\nQuand tu mentionnes un plan (mixité sociale, zonage, emplacements réservés, hauteurs...), utilise UNIQUEMENT le lien dont le nom correspond au sujet. Si aucun plan listé ne correspond au sujet (nom générique "Plan graphique N" ou sujet absent de la liste), ne mets PAS de lien de téléchargement et ne devine JAMAIS quel numéro de plan correspond à quel contenu : indique à la place de consulter le plan recherché en le nommant précisément (ex: "le plan de mixité sociale", "le plan des hauteurs") sur la visionneuse GPU ou sur le site de la commune' + (commune ? ` de ${commune}` : '') + ' / de l\'intercommunalité (rubrique urbanisme ou PLU).'
    : (zonageUrl ? `\nPlan graphique : ${zonageUrl}` : '');
  const planInfo = plansInfo;
  const prompt = PROMPT
    .replace('{ZONE}', zone)
    .replace('{COMMUNE}', communeInfo + planInfo)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // Téléchargement plafonné en streaming : coupe NET au-delà de maxBytes,
    // même si le serveur ne déclare pas de content-length. Rend impossible
    // la saturation mémoire (cf. règlement GPU Plaine Commune à 1,1 Go).
    async function downloadCapped(dlUrl, maxBytes) {
      const r = await fetch(dlUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Téléchargement échoué (' + r.status + ')');
      const cl = parseInt(r.headers.get('content-length') || '0');
      if (cl > maxBytes) {
        try { r.body?.cancel(); } catch (e) {}
        throw new Error('PDF_TROP_VOLUMINEUX:' + Math.round(cl / 1048576));
      }
      const reader = r.body.getReader();
      const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (e) {}
          throw new Error('PDF_TROP_VOLUMINEUX:>' + Math.round(maxBytes / 1048576));
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    const MAX_PDF = 60 * 1024 * 1024; // 60 Mo

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

    // Télécharge le PDF (plafonné)
    let pdfBuffer;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      try {
        pdfBuffer = await downloadCapped(url, MAX_PDF);
      } catch (e) {
        const code2 = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
        const fb = code2 && FALLBACK_URLS[code2 + '_zones'];
        if (/PDF_TROP_VOLUMINEUX/.test(e.message) && fb && url !== fb) {
          console.log('PDF trop lourd (' + e.message.split(':')[1] + ' Mo) → fallback zones');
          url = fb;
          pdfBuffer = await downloadCapped(url, MAX_PDF);
        } else if (/PDF_TROP_VOLUMINEUX/.test(e.message)) {
          return res.status(422).json({ error: 'Le règlement publié sur le Géoportail est trop volumineux pour l\'analyse automatique (' + e.message.split(':')[1] + ' Mo). Téléchargez-le manuellement, extrayez la partie utile (zone concernée) et utilisez l\'upload manuel du PDF.' });
        } else throw e;
      }
      console.log('PDF:', Math.round(pdfBuffer.length / 1024 / 1024), 'MB');
    }

    // Extrait le texte complet avec pdf-parse
    let fullText = await extractText(pdfBuffer);
    console.log('Texte extrait:', fullText.length, 'chars');

    // Pour Plaine Commune : ajoute aussi les dispositions générales (plafonné anti-OOM)
    const urlCode = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
    if (urlCode && FALLBACK_URLS[urlCode + '_general']) {
      try {
        const gb = await downloadCapped(FALLBACK_URLS[urlCode + '_general'], 40 * 1024 * 1024);
        const generalText = await extractText(gb);
        fullText = generalText.slice(0, 40000) + '\n\n' + fullText;
        console.log('Dispositions générales ajoutées');
      } catch(e) { console.log('Dispositions générales ignorées:', e.message); }
    }

    // Extraction intelligente de la section de zone
    const baseZone = zone.replace(/[a-z]+$/, '').replace(/-[A-Z0-9-]+$/, '') || zone;

    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function extractZoneSection(text, z, base) {
      try {
        const zE = escRe(z), bE = escRe(base);
        // 1. Collecte TOUTES les positions candidates (pas seulement la première,
        //    qui est presque toujours dans le sommaire des gros règlements PLUi)
        const patterns = [
          new RegExp('ZONE\\s+' + zE + '\\b', 'gi'),
          new RegExp('ZONE\\s+' + bE + '\\b', 'gi'),
          new RegExp('Article\\s+' + bE + '[\\s.\\-]*1\\b', 'gi'),
          new RegExp('^' + bE + '\\s*[-–—:]', 'gim'),
        ];
        const candidates = new Set();
        for (const p of patterns) {
          let m, guard = 0;
          while ((m = p.exec(text)) !== null && guard++ < 80) candidates.add(m.index);
        }
        if (!candidates.size) return null;
        // 2. Score chaque candidat : densité de contenu réglementaire dans les
        //    4000 chars suivants, MOINS une pénalité "sommaire" (lignes courtes
        //    finissant par des n° de page / pointillés — signature d'une table
        //    des matières, même détaillée comme celle du PLU de Paris),
        //    PLUS un léger bonus de position (le corps vient après le sommaire).
        let best = -1, bestScore = -Infinity;
        for (const pos of candidates) {
          const w = text.slice(pos, pos + 4000);
          const kw = (w.match(/article|chapitre|destination|interdit|autoris|hauteur|emprise|implantation|stationnement|pleine terre|recul/gi) || []).length;
          const wl = w.split('\n').map(l => l.trim()).filter(l => l.length > 3);
          const tocish = wl.filter(l =>
            /[.\u2026]{2,}\s*\d{1,4}$/.test(l) ||                                  // "Hauteur ....... 132"
            (/\s\d{1,4}$/.test(l) && l.length < 70 && !/[m²°%]|m\d|\bm\b/i.test(l)) // ligne courte finissant par un n° de page
          ).length;
          const tocRatio = wl.length ? tocish / wl.length : 0;
          const score = kw * (1 - 1.5 * tocRatio) - tocish + (pos / text.length) * 3;
          if (score > bestScore) { bestScore = score; best = pos; }
        }
        if (best === -1) return null;
        const start = Math.max(0, best - 300);
        // 3. Fin de section : prochaine ZONE DIFFÉRENTE (ignore les en-têtes de page
        //    qui répètent la zone courante)
        let end = Math.min(start + 80000, text.length);
        const reEnd = new RegExp('\\n\\s*ZONE\\s+([A-Z][A-Z0-9]*[a-z]*)\\b', 'g');
        reEnd.lastIndex = start + 500;
        let mm;
        while ((mm = reEnd.exec(text)) !== null && mm.index < end) {
          const lbl = mm[1].toUpperCase();
          if (lbl !== z.toUpperCase() && lbl !== base.toUpperCase()) { end = mm.index; break; }
        }
        console.log('Zone section: start=' + start + ' end=' + end + ' score=' + bestScore);
        return text.slice(start, end);
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
