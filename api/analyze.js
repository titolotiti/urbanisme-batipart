import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PROMPT = `Tu es un expert en droit de l'urbanisme français travaillant pour un asset manager immobilier.

Voici les extraits du règlement PLU/PLUi pour la zone {ZONE}{COMMUNE}.
Opération étudiée : {OPERATION}{PROJET}

RÈGLES ABSOLUES :
1. Cite UNIQUEMENT les dispositions qui s'appliquent DIRECTEMENT à la zone {ZONE}. Ignore tout ce qui concerne d'autres zones, d'autres communes, d'autres indices non applicables à cette zone.
2. Si le règlement liste plusieurs cas (ex: indices A1/A2/A3, ou règles par commune), cite UNIQUEMENT le cas qui s'applique à {ZONE}. Si l'indice exact n'est pas déterminable sur les extraits, dis-le en une phrase et renvoie au plan graphique — ne liste pas tous les cas.
3. Ne jamais inventer, reconstituer ou extrapoler. Si une information est absente : "Information non trouvée dans les documents analysés" — jamais "Non applicable".
4. PLUi : les règles sont définies par zone. S'il existe des dispositions spécifiques à la zone {ZONE} ET des dispositions générales, combine-les. Ignore les dispositions des autres zones.

Si tu cites un plan graphique ou document cartographique, inclus TOUJOURS son lien sous la forme : [↗ Nom du plan](URL)

---

# ANALYSE RÉGLEMENTAIRE — 4 VOLETS OBLIGATOIRES

## ① Destinations — Habitation
Statut de la destination **Habitation** dans la zone :
- Sous-destination **Logement** : ✅ Autorisé / ⚠️ Sous conditions / ❌ Interdit
- Sous-destination **Hébergement** : ✅ Autorisé / ⚠️ Sous conditions / ❌ Interdit

Pour chaque verdict : cite l'article et le texte exact. Si sous conditions : précise les conditions exactes.
> *Article XX :* "Texte exact."

---

## ② Mixité sociale (SMS / logements sociaux)
**Rechercher OBLIGATOIREMENT tous ces termes dans les extraits :**
SMS, Secteur de Mixité Sociale, Servitude de Mixité Sociale, logements sociaux, logements locatifs sociaux, part minimale de logements sociaux, L151-15, L.151-15, diversité de l'habitat, objectif de mixité, programme de logements sociaux, obligation de logements aidés, logements abordables.

**Résultat :** Trouvé ✅ / Information non trouvée dans les documents analysés

**Si trouvé, détailler OBLIGATOIREMENT :**
- % de logements sociaux imposé
- Types exigés (PLAI / PLUS / PLS)
- Seuil de déclenchement (m² SDP ou nombre de logements)
- Champ d'application EXACT : reproduire mot pour mot les termes ("nouvelles constructions", "opérations de reconstruction", "surfaces nouvellement créées", etc.)
- **Applicabilité à l'opération :** ✅ Applicable / ⚠️ Ambiguë / ❌ Non applicable
- **Raisonnement obligatoire :** un changement de destination pur sans création de surface n'est pas forcément une "construction à édifier" ou une "reconstruction" — analyser les termes exacts et conclure

**Statut cartographique :** la présence de la parcelle dans un périmètre SMS ne peut être confirmée que sur le plan de mixité sociale — indiquer le lien vers ce plan s'il est disponible.
> *Article XX :* "Texte exact."

---

## ③ Taille minimale des logements
**Rechercher OBLIGATOIREMENT tous ces termes dans les extraits :**
STML, taille minimale, superficie minimale, surface minimale, surface de plancher minimale, taille et capacité d'accueil, répartition T1/T2/T3/T4/T5, % de grands logements, % de logements de type X, division foncière, lot minimal.

**Résultat :** Trouvé ✅ / Information non trouvée dans les documents analysés

**Si trouvé, détailler OBLIGATOIREMENT :**
- Superficie minimale par logement (m² SDP ou SHAB)
- Répartition obligatoire par type (ex: min 30% de T3+)
- Seuil de déclenchement (nb logements ou m² SDP)
- Champ d'application exact
- **Applicabilité à l'opération :** ✅ / ⚠️ / ❌ avec raisonnement
> *Article XX :* "Texte exact."

---

## ④ Mixité fonctionnelle
**Rechercher OBLIGATOIREMENT tous ces termes dans les extraits :**
mixité fonctionnelle, linéaire commercial, linéaire de protection, rez-de-chaussée actif, RDC actif, animation commerciale, protection du commerce, protection de l'artisanat, obligation de commerce, % logement / % commerce imposé, quote-part, sous-destination obligatoire en RDC, destination imposée.

**Résultat :** Trouvé ✅ / Information non trouvée dans les documents analysés

**Si trouvé, détailler OBLIGATOIREMENT :**
- % de logement imposé (minimum ou maximum)
- % de commerce / activité imposé
- Linéaires commerciaux concernés (avec lien vers le plan si disponible)
- Seuil de déclenchement
- **Applicabilité à l'opération :** ✅ / ⚠️ / ❌ avec raisonnement
> *Article XX :* "Texte exact."

---

## ⑤ Stationnement
**Rechercher dans les extraits :**
Places de stationnement, parking, véhicules, vélos, stationnement logement, stationnement hébergement, norme de stationnement, dérogation stationnement.

**Résultat :** Trouvé ✅ / Information non trouvée dans les documents analysés

**Si trouvé, détailler :**
- Norme voitures : X place(s) par logement (préciser par type T1/T2/T3+ si différencié)
- Norme vélos : X m² ou X place(s) par logement
- Dérogations possibles (proximité transports, mutualisation, caves/celliers)
- **Applicabilité à l'opération :** ✅ / ⚠️ / ❌
> *Article XX :* "Texte exact."

---

RAPPEL FINAL : pour chaque volet, si l'information n'est pas dans les extraits fournis → "Information non trouvée dans les documents analysés". Ne jamais écrire "Non applicable". Commence directement par le volet ①.`;

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
  // Base de zone : lettres initiales + chiffre immédiat uniquement
  // Ex: U1-C-1→U1, UM1c3→UM1, UPGE06→UPGE06, UAb→UA, U4a→U4
  const baseZone = (zone.match(/^([A-Z]+\d*)/)?.[1]) || zone;
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
    return fullText.slice(0, 220000); // doublé: 120k→220k
  }

  const combined = generalSection + '\n\n--- ZONE ' + zone + ' ---\n\n' + zoneSection;
  return combined.slice(0, 220000); // doublé: 120k→220k
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64, commune, address, zonageUrl, planUrls, projet, smsData } = req.body;
  console.log('Params:', { zone, commune, address: address?.slice(0, 40), projet: projet?.slice(0, 60) });

  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const communeInfo = commune ? `\nCommune : ${commune}${address ? ' — ' + address : ''}` : '';

  // Base de zone : lettres initiales + chiffre immédiat — ignore les indices
  // Ex: U1-C-1→U1, UAb6e9→UA, UM1c3→UM1, UPGE06→UPGE06
  const baseZone = (zone.match(/^([A-Z]+\d*)/)?.[1]) || zone;

  const plansInfo = (planUrls && planUrls.length)
    ? '\nPlans graphiques disponibles (liens de téléchargement) — le nom indiqué est le titre RÉEL du plan :\n' + 
      planUrls.map(p => `- ${p.nom} : ${p.url}`).join('\n') +
      '\nQuand tu mentionnes un plan (mixité sociale, zonage, emplacements réservés, hauteurs...), utilise UNIQUEMENT le lien dont le nom correspond au sujet. Si aucun plan listé ne correspond au sujet (nom générique "Plan graphique N" ou sujet absent de la liste), ne mets PAS de lien de téléchargement et ne devine JAMAIS quel numéro de plan correspond à quel contenu : indique à la place de consulter le plan recherché en le nommant précisément (ex: "le plan de mixité sociale", "le plan des hauteurs") sur la visionneuse GPU ou sur le site de la commune' + (commune ? ` de ${commune}` : '') + ' / de l\'intercommunalité (rubrique urbanisme ou PLU).'
    : (zonageUrl ? `\nPlan graphique : ${zonageUrl}` : '');
  // Info SMS cartographique (récupérée depuis APICarto GPU info-surf)
  const smsInfo = smsData && smsData.length > 0
    ? '\n\n⚠️ DONNÉE CARTOGRAPHIQUE CONFIRMÉE — Cette parcelle est située dans un SECTEUR DE MIXITÉ SOCIALE : ' +
      smsData.map(s => s.libelle).join(', ') +
      '. Tu n\'as pas besoin de dire "à vérifier cartographiquement" pour ce point — c\'est confirmé. Analyse l\'applicabilité de la règle SMS de ce secteur à l\'opération.'
    : smsData !== null && smsData !== undefined
      ? '\n\n✅ DONNÉE CARTOGRAPHIQUE CONFIRMÉE — Cette parcelle n\'est dans AUCUN secteur de mixité sociale (SMS) selon le Géoportail de l\'Urbanisme. Pas d\'obligation de logements sociaux liée à la localisation de la parcelle.'
      : '';

  // Note sur le code de zone : dans les règlements à indices (ex: U1-C-1),
  // le texte du règlement utilise uniquement le code court (ex: U1).
  // On l'indique à l'IA pour qu'elle cherche avec le bon identifiant.
  const zoneNote = zone !== baseZone
    ? `\n\nNOTE ZONE : La zone s'affiche "${zone}" mais dans le texte du règlement, cherche les dispositions sous le code court "${baseZone}" (les indices "-C-1" sont des sous-indices traités dans des articles séparés, pas dans le nom de zone).`
    : '';

  const prompt = PROMPT
    .replace('{ZONE}', zone)
    .replace('{COMMUNE}', communeInfo + plansInfo + smsInfo + zoneNote)
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType)
    .replace('{PROJET}', projet ? '\nDescription du projet envisagé par le client (raisonne sur CE projet précis, notamment pour l\'applicabilité des servitudes en ③) : ' + String(projet).slice(0, 1500) : '');

  try {
    // Téléchargement plafonné en streaming : coupe NET au-delà de maxBytes,
    // même si le serveur ne déclare pas de content-length. Rend impossible
    // la saturation mémoire (cf. règlement GPU Plaine Commune à 1,1 Go).
    async function downloadCapped(dlUrl, maxBytes) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(new Error('timeout 120s')), 120000);
      let r;
      try {
        r = await fetch(dlUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
      } finally { clearTimeout(tid); }
      if (!r.ok) {
        console.log('Téléchargement échoué', r.status, 'sur:', dlUrl);
        throw new Error('Téléchargement échoué (' + r.status + ')');
      }
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

    // Retry sur échec transitoire (404/blocage temporaire du serveur distant)
    // + cache mémoire des règlements déjà téléchargés (lambda chaude)
    globalThis.__pdfBufCache = globalThis.__pdfBufCache || new Map();
    async function downloadWithRetry(u, cap, tries = 3) {
      if (globalThis.__pdfBufCache.has(u)) { console.log('Téléchargement (cache):', u.slice(0, 90)); return globalThis.__pdfBufCache.get(u); }
      let lastErr;
      for (let i = 1; i <= tries; i++) {
        try {
          console.log(`Téléchargement (${i}/${tries}):`, u.slice(0, 120));
          const buf = await downloadCapped(u, cap);
          if (buf.length <= 30 * 1024 * 1024) {
            if (globalThis.__pdfBufCache.size >= 5) globalThis.__pdfBufCache.delete(globalThis.__pdfBufCache.keys().next().value);
            globalThis.__pdfBufCache.set(u, buf);
          }
          return buf;
        } catch (e) {
          lastErr = e;
          if (/PDF_TROP_VOLUMINEUX/.test(e.message)) throw e; // inutile de réessayer
          console.log(`Échec téléchargement ${i}/${tries}:`, e.message);
          if (i < tries) await new Promise(r => setTimeout(r, 900 * i));
        }
      }
      throw lastErr;
    }

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

    // Repli générique pour règlements trop volumineux : l'API GPU liste les
    // pièces du document — beaucoup de collectivités publient AUSSI le
    // règlement en morceaux (partie 1, partie 2, zones...) qui tiennent
    // dans le plafond mémoire. Universel : fonctionne pour tout PLU/PLUi.
    async function gpuReglementPieces(docUrl) {
      try {
        const m = (docUrl || '').match(/documents\/DU_\w+\/([0-9a-f]{16,40})\//);
        if (!m) return null;
        const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document/${m[1]}/files`, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        if (!r.ok) return null;
        const files = await r.json();
        if (!Array.isArray(files)) return null;
        const base = docUrl.slice(0, docUrl.lastIndexOf('/'));
        return files
          // Motif STRICT : {codgeo}_reglement[_N]_{date}.pdf — exclut les annexes
          // pièges comme "info_surf_19_01_reglement_sanitaire" ou les SUP
          .filter(f => /^\w+?_reglement(_\d+)?_\d{8}\.pdf$/i.test(f.name || '') && !/graphique/i.test(f.name || ''))
          .map(f => ({ name: f.name, title: f.title || '', url: base + '/' + f.name }));
      } catch (e) { console.log('gpuReglementPieces err:', e.message); return null; }
    }

    // Télécharge le PDF (plafonné + retry + cache), avec chaîne de repli croisée :
    // url choisie → fallback zones → URL GPU d'origine → pièces séparées GPU
    let pdfBuffer = null, preExtractedText = null;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      const code2 = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
      const fb = code2 && FALLBACK_URLS[code2 + '_zones'];
      const tries = [...new Set([url, fb, pluUrl].filter(Boolean))];
      let lastErr = null;
      for (const tryUrl of tries) {
        try {
          pdfBuffer = await downloadWithRetry(tryUrl, MAX_PDF, 2);
          url = tryUrl; lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          console.log('Abandon de', tryUrl.slice(0, 90), '→', e.message);
        }
      }
      // Dernier recours : pièces de règlement séparées listées par l'API GPU
      if (lastErr) {
        const pieces = (await gpuReglementPieces(pluUrl)) || [];
        const others = pieces.filter(p => !tries.includes(p.url));
        console.log('Pièces de règlement séparées trouvées:', others.length, others.map(p => p.name).join(' ; ').slice(0, 200));
        const texts = [];
        for (const p of others.slice(0, 5)) {
          try {
            const buf = await downloadWithRetry(p.url, MAX_PDF, 3);
            texts.push(await extractText(buf));
            console.log('Pièce utilisée:', p.name, '(' + Math.round(buf.length / 1048576) + ' Mo)');
          } catch (e) { console.log('Pièce ignorée:', p.name, '→', e.message); }
          if (texts.length >= 3) break;
        }
        if (texts.length) {
          const combined = texts.join('\n\n');
          // Garde-fou : un règlement réel fait des dizaines de milliers de
          // caractères — un texte squelettique signifie qu'on a attrapé une
          // mauvaise pièce, mieux vaut continuer vers le recours suivant
          if (combined.length >= 8000) {
            preExtractedText = combined;
            lastErr = null;
          } else {
            console.log('Pièces rejetées (texte insuffisant:', combined.length, 'chars) → recours suivant');
          }
        }
      }
      // Ultime recours (règlement monolithique géant, aucune pièce séparée) :
      // une tentative avec plafond étendu — nécessite la mémoire augmentée
      // dans vercel.json. Au-delà de 130 Mo, on renonce proprement.
      if (lastErr && /PDF_TROP_VOLUMINEUX/.test(lastErr.message)) {
        try {
          console.log('Tentative plafond étendu (130 Mo) sur le règlement principal...');
          pdfBuffer = await downloadCapped(pluUrl, 130 * 1024 * 1024);
          console.log('Règlement volumineux récupéré:', Math.round(pdfBuffer.length / 1048576), 'Mo');
          lastErr = null;
        } catch (e) {
          lastErr = e;
          console.log('Plafond étendu insuffisant:', e.message);
        }
      }
      if (lastErr) {
        if (/PDF_TROP_VOLUMINEUX/.test(lastErr.message)) {
          return res.status(422).json({ error: 'Le règlement publié sur le Géoportail est trop volumineux pour l\'analyse automatique (' + lastErr.message.split(':')[1] + ' Mo) et aucune pièce séparée exploitable n\'a été trouvée. Téléchargez-le manuellement, extrayez la partie utile (zone concernée) et utilisez l\'upload manuel du PDF.' });
        }
        return res.status(422).json({ error: 'Impossible de télécharger le règlement après plusieurs tentatives (' + lastErr.message + '). Le serveur de la collectivité est peut-être temporairement indisponible : réessayez dans quelques minutes, ou téléchargez le règlement manuellement et utilisez l\'upload manuel du PDF.' });
      }
      if (pdfBuffer) console.log('PDF:', Math.round(pdfBuffer.length / 1024 / 1024), 'MB');
    }

    // Extrait le texte complet avec pdf-parse (ou texte déjà extrait des pièces séparées)
    let fullText = preExtractedText || await extractText(pdfBuffer);
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
    // Base de zone : lettres initiales + chiffre immédiat uniquement
  // Ex: U1-C-1→U1, UM1c3→UM1, UPGE06→UPGE06, UAb→UA, U4a→U4
  const baseZone = (zone.match(/^([A-Z]+\d*)/)?.[1]) || zone;
  // Zone courte pour les recherches thématiques (SMS, taille, mixité fonctionnelle) :
  // uniquement les 2 premières lettres + chiffre optionnel — ignore les indices
  // Ex: U1-C-1→U1, UPGE06→UP... non, garder baseZone qui est déjà correct
  // En réalité : baseZone suffit (U1, UMH, UPGE06 sont déjà les bons codes)
  // shortZone = 2 premières lettres SEULEMENT pour les recherches dans fullText
  const shortZone = zone.replace(/^([A-Z]{1,4}\d?).*$/, '$1').toUpperCase();
  console.log('Zone:', zone, '| base:', baseZone, '| short:', shortZone);

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
        // Inclure aussi du contenu AVANT le header de zone :
        // certains règlements (ex: Gennevilliers UPGE) placent les articles
        // de la zone avant son titre. On remonte de 80k pour ne rien manquer.
        const start = Math.max(0, best - 80000);
        // 3. Fin de section : prochaine ZONE DIFFÉRENTE (ignore les en-têtes de page
        //    qui répètent la zone courante). Le regex couvre tous les formats d'ID :
        //    - Précédés de "ZONE " : ZONE UPGE07, ZONE UAb, ZONE UG
        //    - Sans préfixe "ZONE" : UPGE07 —, UPGE07.1, Article UPGE07
        //    - Avec tiret ou point : UA-1, U.2
        let end = Math.min(best + 160000, text.length);
        const reEnd = new RegExp(
          '\\n\\s*(?:' +
            'ZONE\\s+([A-Z][A-Z0-9]*(?:[.\\-][A-Z0-9]+)*[a-z]?\\d*)' +      // "ZONE UPGE07"
            '|CHAPITRE\\s+(?:ZONE\\s+)?([A-Z][A-Z0-9]*(?:[.\\-][A-Z0-9]+)*[a-z]?\\d*)' + // "CHAPITRE ZONE UA"
            '|([A-Z]{2,}[A-Z0-9]*\\d+[a-z]?)\\s*[-–—:]' +                    // "UPGE07 —" ou "UPGE07:" (pas de point : évite "UPGE07.1")
            '|Article\\s+([A-Z]{2,}[A-Z0-9]*\\d+[a-z]?)\\.?1\\b' +           // "Article UPGE07.1"
          ')',
          'g'
        );
        reEnd.lastIndex = best + 500;  // cherche la fin APRÈS le header, pas depuis start élargi
        let mm;
        while ((mm = reEnd.exec(text)) !== null && mm.index < end) {
          const lbl = (mm[1] || mm[2] || mm[3] || mm[4] || '').toUpperCase();
          if (lbl && lbl !== z.toUpperCase() && lbl !== base.toUpperCase()) { end = mm.index; break; }
        }
        console.log('Zone section: start=' + start + ' end=' + end + ' score=' + bestScore);
        return text.slice(start, end);
      } catch(e) { return null; }
    }

    // ── Extraction thématique transversale : MIXITÉ SOCIALE ──
    // Le volet "logements sociaux" de chaque analyse dépend de chapitres
    // transversaux (servitudes/secteurs de mixité sociale, L151-15) situés
    // HORS de la section de zone — souvent au milieu du règlement, donc
    // invisibles avec le seul découpage début + zone. On localise le passage
    // le plus dense en occurrences et on l'envoie systématiquement.
    function extractTopicSection(text, pattern, cap = 16000) {
      try {
        const re = new RegExp(pattern, 'gi');
        const hits = []; let m;
        while ((m = re.exec(text)) !== null && hits.length < 400) hits.push(m.index);
        if (!hits.length) return null;
        // Cluster le plus dense : pour chaque occurrence, nb d'occurrences
        // dans les `cap` caractères suivants
        let best = hits[0], bestN = -1;
        for (const h of hits) {
          const n = hits.filter(x => x >= h && x < h + cap).length;
          if (n > bestN) { bestN = n; best = h; }
        }
        const start = Math.max(0, best - 1500);
        return text.slice(start, Math.min(start + cap, text.length));
      } catch (e) { return null; }
    }

    const generalText = fullText.slice(0, 40000);
    const zoneSection = extractZoneSection(fullText, zone, baseZone);

    // ── Extracteurs thématiques transversaux ────────────────────────────────
    // Ces trois volets sont souvent dans des chapitres séparés de la section de
    // zone — on localise les DEUX clusters les plus denses pour chacun et on
    // prend les deux (jusqu'à 2×8000 chars) pour maximiser la couverture.

    function extractTopicSections(text, pattern, cap = 16000, maxClusters = 2) {
      try {
        const re = new RegExp(pattern, 'gi');
        const hits = []; let m;
        while ((m = re.exec(text)) !== null && hits.length < 600) hits.push(m.index);
        if (!hits.length) return null;
        const results = [];
        const used = new Set();
        for (let k = 0; k < maxClusters; k++) {
          let best = -1, bestN = -1;
          for (const h of hits) {
            if (used.has(h)) continue;
            const n = hits.filter(x => x >= h && x < h + cap && !used.has(x)).length;
            if (n > bestN) { bestN = n; best = h; }
          }
          if (best === -1 || bestN < 2) break;
          const s = Math.max(0, best - 1500);
          const snippet = text.slice(s, Math.min(s + cap, text.length));
          results.push(snippet);
          // Marque les hits couverts
          hits.filter(x => x >= s && x < s + cap).forEach(x => used.add(x));
        }
        return results.length ? results.join('\n\n[...]\n\n') : null;
      } catch (e) { return null; }
    }

    // 1. MIXITÉ SOCIALE — tous les termes possibles (SMS, L151-15, diversité habitat...)
    const mixiteSection = extractTopicSections(fullText,
      'SMS|secteurs?\\s+de\\s+mixit[ée]\\s+sociale|servitude\\s+de\\s+mixit[ée]|' +
      'mixit[ée]\\s+sociale|logements?\\s+(?:locatifs?\\s+)?sociaux|' +
      'part\\s+minimale\\s+de\\s+logements?\\s+sociaux|pourcentage\\s+de\\s+logements?\\s+sociaux|' +
      'diversit[ée]\\s+de\\s+l.habitat|objectif\\s+de\\s+mixit[ée]|' +
      'L\\.?\\s*151-15|article\\s+L\\.?\\s*302|programme\\s+de\\s+logements?\\s+sociaux|' +
      'servitude\\s+logement|obligation\\s+de\\s+logements?\\s+sociaux|' +
      'part\\s+de\\s+logements?\\s+(?:abordables?|accessibles?|aid[ée]s?)',
      16000);

    // 2. TAILLE MINIMALE DE LOGEMENTS — surface, typo, STML, répartition T1/T2/T3
    const tailleSection = extractTopicSections(fullText,
      'taille\\s+minimale|surface\\s+minimale|superficie\\s+minimale|' +
      'STML|secteur\\s+de\\s+taille\\s+(?:et\\s+capacit[ée]|minimale)|' +
      'taille\\s+et\\s+capacit[ée]\\s+d.accueil|' +
      'typ(?:e|ologie)\\s+(?:de\\s+)?logements?\\s*:?\\s*T[1-5]|' +
      'minimum\\s+de\\s+(?:T[1-5]|\\d+\\s*%\\s*de\\s*(?:logements?|T))|' +
      'au\\s+moins\\s+\\d+\\s*%\\s*(?:de\\s+)?(?:logements?|T[1-5])|' +
      'r[ée]partition\\s+(?:des?\\s+)?(?:logements?|typologies?)|' +
      '\\d+\\s*%\\s*(?:de\\s+)?(?:grands?\\s+)?logements?\\s+(?:de\\s+)?type\\s+T|' +
      'logements?\\s+de\\s+(?:grande|petite)\\s+taille|' +
      'unité\\s+foncière\\s+minimale|lot\\s+minimal|division\\s+fonci[èe]re',
      16000);

    // 3. MIXITÉ FONCTIONNELLE — %, commerce obligatoire, RDC actif, linéaires
    const mixiteFoncSection = extractTopicSections(fullText,
      'mixit[ée]\\s+fonctionnelle|diversit[ée]\\s+fonctionnelle|mixit[ée]\\s+des\\s+destinations?|' +
      'lin[ée]aires?\\s+(?:de\\s+)?(?:commerces?|activit[ée]s?|protection|d[ée]veloppement)|' +
      'rez-de-chauss[ée]e\\s+(?:actif|commercial)|RDC\\s+actif|animation\\s+commerciale|' +
      'protection\\s+(?:du\\s+)?commerce|obligation\\s+de\\s+(?:commerces?|activit[ée]s?)|' +
      '(?:part|quote-?part|proportion|pourcentage)\\s+(?:de\\s+)?(?:logements?|bureaux|commerces?)|' +
      '\\d+\\s*%\\s*(?:de\\s+(?:la\\s+)?)?(?:surface|SDP|SHON)\\s+(?:(?:de\\s+)?)?(?:commerce|activit[ée]|logement)|' +
      'destination(?:s)?\\s+(?:obligatoire|impos[ée]e?|exig[ée]e?)|' +
      'sous-destination\\s+(?:obligatoire|minimum|imposé)|' +
      'r[ée]partition\\s+(?:des?\\s+)?(?:surfaces?|destinations?|usages?)',
      16000);

    // Fonction de déduplication : n'ajoute une section que si elle n'est pas
    // déjà couverte par le texte déjà envoyé
    function addIfNew(existing, section) {
      if (!section) return false;
      const probe = section.slice(2000, 2400);
      return probe && !existing.includes(probe);
    }

    async function callClaude(promptText) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 9000,
          messages: [{ role: 'user', content: promptText }]
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(d.error));
      return d.content[0].text;
    }

    // ── Un seul appel avec TOUT le contenu de la zone ──────────────────────
    // Claude Sonnet supporte ~200k tokens (≈800k chars) — largement suffisant
    // pour n'importe quelle section de zone, même les gros PLUi.
    // On arrête le découpage qui causait des articles manquants.
    let sendText;
    if (zoneSection) {
      sendText = generalText + '\n\n--- ZONE ' + zone + ' ---\n\n' + zoneSection;
      console.log('Zone trouvée:', zoneSection.length, 'chars');
    } else {
      const third = Math.floor(fullText.length / 3);
      sendText = fullText.slice(0, 80000) + '\n...\n' + fullText.slice(third, third + 80000) + '\n...\n' + fullText.slice(-60000);
      console.log('Zone non trouvée, découpage 3 parties');
    }

    // Ajoute les sections thématiques si non déjà couvertes
    for (const { label, section } of [
      { label: 'MIXITÉ SOCIALE / LOGEMENTS SOCIAUX', section: mixiteSection },
      { label: 'TAILLE MINIMALE / TYPOLOGIE DES LOGEMENTS', section: tailleSection },
      { label: 'MIXITÉ FONCTIONNELLE / LINÉAIRES COMMERCIAUX', section: mixiteFoncSection },
    ]) {
      if (!section || !addIfNew(sendText, section)) continue;
      sendText += '\n\n--- ' + label + ' ---\n\n' + section;
      console.log('Section', label, 'ajoutée:', section.length, 'chars');
    }

    console.log('Texte envoyé:', sendText.length, 'chars');

    const fullPrompt = 'Voici les extraits du règlement PLU pour la zone "' + zone + '".\n\nRÈGLE ABSOLUE : ne cite et n\'utilise QUE les dispositions présentes dans les extraits ci-dessous.\n\n' + sendText + '\n\n---\n\n' + prompt;

    let analysisText = await callClaude(fullPrompt);
    console.log('✓ Analyse OK');

        // ── Détection et injection des articles manquants ────────────────────

    // ── INJECTION DES ARTICLES MANQUANTS ──────────────────────────────────────
    // Si l'IA mentionne des articles dont le contenu n'est "pas reproduit dans
    // les extraits" ou "non transmis", on les cherche dans fullText et on
    // relance un appel pour compléter l'analyse.
    const missingSignals = [
      /son contenu (?:textuel )?(?:complet )?n['']est pas reproduit/i,
      /n[''](?:est|a) pas (?:été )?(?:transmis?|reproduit|présent)/i,
      /absent(?:s)? des extraits/i,
      /ne figure(?:nt)? pas dans les extraits/i,
      /non (?:présent|transmis?|reproduit) dans les extraits/i,
    ];
    const hasMissing = missingSignals.some(re => re.test(analysisText));

    if (hasMissing && fullText) {
      // Extrait les références d'articles mentionnés comme manquants
      // ex: UG.1.4.2, article L151-15, article 3.5, 4.5.2.1.1
      const artRefs = [...new Set([
        ...(analysisText.match(/\b(?:article\s+)?([A-Z]{1,5}[\d.]+[\d.]+\w*)/gi) || []),
        ...(analysisText.match(/article\s+([\d]+\.[\d.]+)/gi) || []),
        ...(analysisText.match(/article\s+(L[\d]+-[\d]+)/gi) || []),
      ])].map(r => r.replace(/^article\s+/i, '').trim()).filter(r => r.length > 2);

      // Pour chaque référence, cherche le texte dans fullText
      const found = [];
      for (const ref of artRefs.slice(0, 6)) { // max 6 articles
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?:' + escaped + ')([\\s\\S]{0,3000}?)(?=\\n(?:' + escaped.slice(0,-1) + '|ZONE |ARTICLE |CHAPITRE )|$)', 'i');
        const m = re.exec(fullText);
        if (m && m[0].length > 100) {
          found.push({ ref, text: m[0].slice(0, 3000) });
          console.log('Article manquant récupéré:', ref, '(' + m[0].slice(0,3000).length + ' chars)');
        }
      }

      if (found.length > 0) {
        const supplement = found.map(f => `=== ARTICLE ${f.ref} (récupéré depuis le règlement complet) ===\n${f.text}`).join('\n\n');
        const completionPrompt = `L'analyse suivante signale des articles dont le contenu n'était pas dans les extraits initiaux. Voici ces articles extraits du règlement complet.\n\nRÈGLE ABSOLUE : complète UNIQUEMENT les sections où tu as signalé une lacune, en citant le texte exact fourni ci-dessous. Ne modifie pas les sections déjà complètes. Insère les nouvelles informations à leur place logique dans l'analyse.\n\n--- ARTICLES RÉCUPÉRÉS ---\n${supplement}\n\n--- ANALYSE À COMPLÉTER ---\n${analysisText}`;

        const r2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 9000,
            messages: [{ role: 'user', content: completionPrompt }]
          })
        });
        const d2 = await r2.json();
        if (r2.ok) {
          analysisText = d2.content[0].text;
          console.log('✓ Analyse complétée avec', found.length, 'article(s) manquant(s)');
        } else {
          console.log('Complétion échouée:', JSON.stringify(d2.error));
        }
      } else {
        console.log('Articles manquants non trouvables dans fullText');
      }
    }

    console.log('✓ Analyse OK');
    return res.status(200).json({ success: true, zone, analysisType, result: analysisText });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
