import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PROMPT = `Tu es un expert en droit de l'urbanisme français travaillant pour un asset manager immobilier. Tu produis une ÉTUDE DE FAISABILITÉ RÉGLEMENTAIRE du niveau d'exigence d'une agence d'architecture (étude capacitaire réglementaire), pas un simple résumé.
Voici les extraits du règlement PLU pour la zone {ZONE}{COMMUNE}.
Opération étudiée : {OPERATION}{PROJET}

IMPORTANT : Dans un PLUi, les règles sont définies par zone (pas par commune) — elles s'appliquent identiquement à toute parcelle de cette zone, quelle que soit la commune. Analyse les règles de la zone indiquée sans filtrer par commune.
Si tu mentionnes un plan graphique, un plan de zonage ou un document cartographique, inclus TOUJOURS le lien de téléchargement fourni ci-dessus directement dans ta réponse sous la forme : [↗ Télécharger le plan graphique]({URL})

# ÉTUDE DE FAISABILITÉ RÉGLEMENTAIRE

## ⓪ Synthèse
**Verdict global :** ✅ Possible / ⚠️ Sous conditions / ❌ Interdit / ❓ Non déterminable sur les extraits
3-4 phrases : ce qui est faisable, les 2-3 contraintes majeures, le point le plus discriminant.

## ① Destinations et faisabilité de l'opération
Destinations autorisées/interdites/sous conditions dans la zone, et verdict motivé pour l'opération étudiée.
> *Page XX — Article YY :* "Passage exact."

## ② Règles morphologiques (tableau exhaustif)
Pour CHAQUE thème ci-dessous présent dans les extraits, donne la règle chiffrée exacte avec citation. Si un thème est absent des extraits, écris "Non présent dans les extraits transmis" (ne saute pas le thème) :
- **Implantation / voies et emprises publiques** (alignement, recul)
- **Limites séparatives** (retraits L=H/2, baies principales/secondaires)
- **Emprise au sol** (%)
- **Hauteurs** (hauteur de façade, couronnement/attique, hauteur totale, niveaux)
- **Saillies, balcons, oriels sur domaine public** (dimensions, hauteur minimale, % de façade)
- **Pleine terre / CBS / espaces verts** (%, coefficients)
- **Stationnement** (voitures et vélos par destination, et toute possibilité de dérogation/mutualisation)
> *Page XX — Article YY :* "Passage exact." (pour chaque règle)

## ③ Servitudes de mixité et leur APPLICABILITÉ à l'opération
C'est le cœur de l'étude. Pour chaque servitude trouvée (Secteur de Mixité Sociale, Secteur de Taille Minimale de Logements, mixité fonctionnelle, linéaire commercial) :
1. Cite la règle exacte avec ses seuils (m² de SDP, nombre de logements, %).
2. Analyse les TERMES EXACTS de son champ d'application ("constructions à édifier", "opérations de reconstruction", "surfaces nouvellement créées"...) et conclus si elle s'applique ou non à l'opération étudiée. Exemple de raisonnement attendu : une surélévation d'un bâtiment conservé n'est ni une "construction à édifier" ni une "reconstruction" — si le règlement emploie ces seuls termes, la servitude est probablement inapplicable, à faire confirmer par la collectivité.
3. Verdict par servitude : ✅ Applicable / ⚠️ Applicabilité ambiguë (à confirmer) / ❌ Non applicable.
> *Page XX — Article YY :* "Passage exact."

## ④ Dispositions favorables mobilisables
Recherche activement dans les extraits : bonus de constructibilité, hauteur complémentaire (ex. surélévation + rénovation énergétique), majorations pour logement, dérogations de stationnement (ex. au profit de caves/celliers), règles alternatives pour constructions existantes. Pour chacune : conditions exactes et gain potentiel.
> *Page XX — Article YY :* "Passage exact."

## ⑤ Points de vigilance et ambiguïtés
Formulations ambiguës du règlement, marges d'interprétation de la collectivité, contradictions entre dispositions, et ce qu'il faut faire confirmer PAR ÉCRIT avant d'engager des études. Sois critique comme le serait un architecte-conseil.

## ⑥ Vérifications cartographiques requises
Liste précise des plans à consulter (zonage, hauteurs, SMS, emplacements réservés, PPRI...) et ce qu'il faut y vérifier pour cette adresse. Utilise les liens fournis selon les règles ci-dessus.

## ⑦ Questions à poser à la collectivité
3 à 6 questions précises, prêtes à envoyer au service urbanisme, ciblées sur les ambiguïtés identifiées en ③ et ⑤.

RÈGLES DE RIGUEUR :
- Texte EXACT entre guillemets, toujours avec page et article. Ne JAMAIS inventer ni "reconstituer" une règle absente des extraits : écris "Non présent dans les extraits transmis".
- Distingue toujours ce que dit le règlement (citation) de ton analyse (raisonnement).
- Ne commence pas par un avertissement préalable. Lance-toi directement dans l'étude.`;

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

  const { zone, analysisType, pluUrl, pluBase64, commune, address, zonageUrl, planUrls, projet } = req.body;
  console.log('Params:', { zone, commune, address: address?.slice(0, 40), projet: projet?.slice(0, 60) });

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
    .replace('{OPERATION}', OPERATIONS[analysisType] || analysisType)
    .replace('{PROJET}', projet ? '\nDescription du projet envisagé par le client (raisonne sur CE projet précis, notamment pour l\'applicabilité des servitudes en ③) : ' + String(projet).slice(0, 1500) : '');

  try {
    // Téléchargement plafonné en streaming : coupe NET au-delà de maxBytes,
    // même si le serveur ne déclare pas de content-length. Rend impossible
    // la saturation mémoire (cf. règlement GPU Plaine Commune à 1,1 Go).
    async function downloadCapped(dlUrl, maxBytes) {
      const r = await fetch(dlUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
            const buf = await downloadWithRetry(p.url, MAX_PDF, 1);
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
        //    qui répètent la zone courante). Le regex couvre tous les formats d'ID :
        //    - Précédés de "ZONE " : ZONE UPGE07, ZONE UAb, ZONE UG
        //    - Sans préfixe "ZONE" : UPGE07 —, UPGE07.1, Article UPGE07
        //    - Avec tiret ou point : UA-1, U.2
        let end = Math.min(start + 160000, text.length);
        const reEnd = new RegExp(
          '\\n\\s*(?:' +
            'ZONE\\s+([A-Z][A-Z0-9]*(?:[.\\-][A-Z0-9]+)*[a-z]?\\d*)' +      // "ZONE UPGE07"
            '|CHAPITRE\\s+(?:ZONE\\s+)?([A-Z][A-Z0-9]*(?:[.\\-][A-Z0-9]+)*[a-z]?\\d*)' + // "CHAPITRE ZONE UA"
            '|([A-Z]{2,}[A-Z0-9]*\\d+[a-z]?)\\s*[-–—:]' +                    // "UPGE07 —" ou "UPGE07:" (pas de point : évite "UPGE07.1")
            '|Article\\s+([A-Z]{2,}[A-Z0-9]*\\d+[a-z]?)\\.?1\\b' +           // "Article UPGE07.1"
          ')',
          'g'
        );
        reEnd.lastIndex = start + 500;
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

    const generalText = fullText.slice(0, 40000);  // doublé : 20k→40k (dispositions générales souvent longues)
    const zoneSection = extractZoneSection(fullText, zone, baseZone);
    const mixiteSection = extractTopicSection(fullText, 'mixit[ée]\\s+sociale|logements?\\s+locatifs?\\s+sociaux|L\\.?\\s*151-15|servitude\\s+de\\s+mixit[ée]|secteurs?\\s+de\\s+mixit[ée]');
    // N'ajoute la section mixité que si elle n'est pas déjà couverte par les
    // extraits envoyés (évite les doublons)
    const mixiteProbe = mixiteSection ? mixiteSection.slice(2000, 2400) : null;
    const mixiteNeeded = mixiteSection && mixiteProbe && !(generalText.includes(mixiteProbe) || (zoneSection || '').includes(mixiteProbe));

    let sendText;
    if (zoneSection) {
      sendText = generalText + '\n\n--- ZONE ' + zone + ' ---\n\n' + zoneSection;
      console.log('Zone trouvée:', zoneSection.length, 'chars');
    } else {
      // Fallback : 3 tranches couvrant l'ensemble du document (doublé : 130k→220k)
      const third = Math.floor(fullText.length / 3);
      sendText = fullText.slice(0, 80000) + '\n...\n' + fullText.slice(third, third + 80000) + '\n...\n' + fullText.slice(-60000);
      console.log('Zone non trouvée, découpage 3 parties');
    }
    if (mixiteNeeded) {
      sendText += '\n\n--- DISPOSITIONS MIXITÉ SOCIALE / LOGEMENTS SOCIAUX (extrait du règlement) ---\n\n' + mixiteSection;
      console.log('Section mixité sociale ajoutée:', mixiteSection.length, 'chars');
    }
    console.log('Texte envoyé:', sendText.length, 'chars');

    const fullPrompt = 'Voici les extraits du règlement PLU pour la zone "' + zone + '".\n\nRÈGLE ABSOLUE : ne cite et n\'utilise QUE les dispositions présentes dans les extraits ci-dessous. N\'invente ni ne "reconstitue" JAMAIS de règles à partir de règles-types, de PLU similaires ou de connaissances générales — en analyse réglementaire, une règle reconstituée est une erreur grave. Si une information n\'est pas dans les extraits, dis-le explicitement et renvoie au règlement complet.\n\n' + sendText + '\n\n---\n\n' + prompt;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 9000,
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
