import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const fs = require('fs');

// Limites configurables via variables d'environnement Vercel
const PDF_MAX_MB = Number(process.env.PDF_MAX_MB || 60);
const LARGE_PDF_MAX_MB = Number(process.env.LARGE_PDF_MAX_MB || 250);

const PROMPT = `Tu es un expert en droit de l'urbanisme français et en faisabilité immobilière. Produis une note de faisabilité urbanistique de niveau professionnel, identique à celles produites par un cabinet d'architecte ou d'urbaniste pour un investisseur immobilier.

Zone : {ZONE}{COMMUNE}
Opération : {OPERATION}{PROJET}

RÈGLES ABSOLUES :
- Cite UNIQUEMENT ce qui est dans les extraits fournis. Si absent : statut "❓", resume "Non trouvé dans les extraits." — ne jamais inventer un chiffre, un seuil, un article ou une page.
- Ne cite que les règles qui s'appliquent à {ZONE}. Ignore les autres zones et indices.
- Pour chaque règle : texte exact entre guillemets + article + page (marqueur --- PAGE N ---).
- TABLEAUX : les lignes séparées par " | " sont des colonnes — extrais les valeurs cellule par cellule.
- Réponds UNIQUEMENT avec le bloc <json>...</json>. Aucun texte avant ni après.

---

ANALYSE EN 10 SECTIONS DANS CET ORDRE EXACT :
1. Habitation / destination
2. Mixité sociale / SMS
3. Taille minimale des logements / STML
4. Mixité fonctionnelle
5. Stationnement
6. Hauteur
7. Emprise au sol
8. Espaces verts / pleine terre
9. Implantation / prospects
10. Risques, servitudes et prescriptions particulières

CHAMPS OBLIGATOIRES PAR SECTION :
- titre : intitulé exact parmi la liste ci-dessus
- statut : "✅" | "⚠️" | "❌" | "🗺️" | "❓" — CHOIX SELON 4 CAS :
  CAS A — règle trouvée ET applicable à ce projet : "✅" → statut_label "Applicable"
  CAS B — règle trouvée ET non applicable (exclusion explicite, seuil non atteint, opération non visée) : "❌" → statut_label "Non applicable"
  CAS C — règle trouvée, mais son APPLICATION PARCELLAIRE dépend d'un plan graphique ou d'une annexe cartographique : "🗺️" → statut_label "À vérifier sur plan graphique"
  CAS D — règle RÉELLEMENT ABSENTE du règlement écrit transmis : "❓" → statut_label "Non trouvé dans le règlement écrit"
  RÈGLE ABSOLUE : n'utilise "❓" que si la règle est vraiment absente — si elle existe mais dépend d'un plan cartographique, utilise "🗺️".
- statut_label : "Applicable" | "Sous conditions" | "Non applicable" | "À vérifier sur plan graphique" | "Non trouvé dans le règlement écrit"
- resume : 1-2 phrases — verdict immédiat pour CE projet
- regle_principale : valeurs exactes (chiffres, %, seuils) ou "Non trouvé dans les extraits."
- article : ex "Art. UH 1.2" — ou "" si absent
- page : numéro de page (--- PAGE N ---) — ou "" si absent
- analyse_detaillee : analyse concise et complète (900 à 1 500 caractères max), structurée ainsi si les informations sont disponibles :
  (a) Règle applicable et son fondement réglementaire
  (b) Champ d'application exact (verbatim) — qui est visé, qui ne l'est pas
  (c) Seuils de déclenchement
  (d) Exclusions et cas particuliers
  (e) Interprétation juridique et qualification de l'opération
  (f) Application concrète au projet décrit — conclusion claire (applicable / non applicable / ambigu)
  (g) Conséquences opérationnelles pour le projet
  (h) Marges de manœuvre éventuelles
  (i) Risques identifiés
- citation : extrait verbatim entre guillemets — ou "" si absent
- points_vigilance : liste de 2 à 4 éléments concrets (plans à consulter, confirmations à obtenir, risques)
- documents_a_consulter : tableau (peut être vide []) — un objet par document externe à consulter :
  { "reference": "Plan graphique n°4.2", "nom_document": "Plan des prescriptions et périmètres particuliers", "raison": "Vérifier si la parcelle est incluse dans un secteur SMS, STML, filet de hauteur ou emplacement réservé.", "url": null }
  N'invente jamais un URL. Si le lien est inconnu, laisse "url": null.
  Inclus un document quand la section utilise "🗺️" ou quand l'analyse cite un plan, une annexe, ou un document cartographique indispensable.
- source_manquante : nom du document manquant si statut "🗺️" ou "❓", sinon ""
- action_recommandee : phrase d'action concrète pour l'utilisateur (ex: "Télécharger le plan graphique n°4.3 et localiser la parcelle dans le secteur colorisé."), sinon ""

CONTRAINTES DE LONGUEUR (impératives — un JSON tronqué est inutilisable) :
- analyse_detaillee : viser 900 à 1 500 caractères, ne jamais dépasser 1 800 caractères
- citation : MAXIMUM 800 caractères
- points_vigilance : 2 à 4 éléments, JAMAIS plus de 4
- documents_a_consulter : 0 à 3 éléments maximum
- synthese dans conclusion_operationnelle : MAXIMUM 200 mots

⚠️ ATTENTION — RÈGLES TRANSVERSALES : Les règles SMS, STML, stationnement, pleine-terre, CBS, hauteur, implantation et risques/servitudes se trouvent SOUVENT dans des chapitres TRANSVERSAUX du règlement, PAS uniquement dans la section de la zone. Des extraits thématiques dédiés sont fournis sous les marqueurs "--- MIXITÉ SOCIALE ---", "--- TAILLE MINIMALE ---", "--- STATIONNEMENT ---", "--- EMPRISE AU SOL ---", "--- IMPLANTATION ---", etc. Analyse ces extraits thématiques même s'ils ne portent pas le nom de la zone. Si une règle transversale existe dans ces extraits, cite-la — ne pas écrire "Non trouvé" si la règle est présente dans un extrait thématique fourni.

LOGIQUE AVANT D'ÉCRIRE "Non trouvé dans le règlement écrit" :
Avant d'utiliser "❓", recherche ces mots-clés dans les extraits :
- Stationnement : "stationnement", "normes", "places", "vélo", "aire de stationnement"
- SMS/mixité sociale : "SMS", "mixité sociale", "logements sociaux", "servitude de mixité", "L151-15"
- STML/taille : "STML", "taille minimale", "T3", "65 %", "typologie", "type 3"
- Pleine terre/CBS : "pleine terre", "CBS", "coefficient de biotope", "perméable"
- Mixité fonctionnelle : "linéaire commercial", "rez-de-chaussée actif", "commerce", "diversité"
- Emplacements réservés : "emplacement réservé", "ER", "bénéficiaire", "voirie"
- Risques/servitudes : "PPRI", "inondation", "carrières", "SUP", "risques naturels"
Si la règle existe dans le règlement mais que son application à la parcelle dépend d'un plan cartographique : utilise "🗺️", précise le plan dans documents_a_consulter et action_recommandee.
Ne jamais écrire "Information non fournie dans les extraits" si on sait quel document permet de conclure.

STANDARD DE QUALITÉ pour analyse_detaillee :
❌ Insuffisant : reprendre une valeur isolée sans préciser le champ d'application, les seuils, les exclusions et l'effet concret sur le projet.
✅ Attendu : expliquer la règle trouvée dans les extraits, citer son article/page, préciser exactement qui est visé, les seuils, les exclusions, puis conclure pour le projet étudié. Ne jamais reprendre un chiffre ou une obligation d'un ancien test : tout chiffre doit venir des extraits fournis pour ce PLU/PLUi.

FORMAT JSON OBLIGATOIRE :
<json>
{
  "sections": [
    {
      "titre": "Habitation / destination",
      "statut": "✅",
      "statut_label": "Applicable",
      "resume": "...",
      "regle_principale": "...",
      "article": "Art. XX",
      "page": "XX",
      "analyse_detaillee": "...",
      "citation": "...",
      "points_vigilance": ["...", "..."],
      "documents_a_consulter": [],
      "source_manquante": "",
      "action_recommandee": ""
    },
    { "titre": "Mixité sociale / SMS", "statut": "🗺️", "statut_label": "À vérifier sur plan graphique", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [{"reference": "Plan graphique n°4.2", "nom_document": "Plan des prescriptions", "raison": "Vérifier si la parcelle est en secteur SMS.", "url": null}], "source_manquante": "Plan graphique n°4.2", "action_recommandee": "Télécharger le plan graphique n°4.2 et localiser la parcelle dans le secteur SMS colorisé." },
    { "titre": "Taille minimale des logements / STML", "statut": "🗺️", "statut_label": "À vérifier sur plan graphique", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Mixité fonctionnelle", "statut": "❓", "statut_label": "Non trouvé dans le règlement écrit", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Stationnement", "statut": "🗺️", "statut_label": "À vérifier sur plan graphique", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Hauteur", "statut": "❓", "statut_label": "Non trouvé dans le règlement écrit", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Emprise au sol", "statut": "❓", "statut_label": "Non trouvé dans le règlement écrit", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Espaces verts / pleine terre", "statut": "🗺️", "statut_label": "À vérifier sur plan graphique", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Implantation / prospects", "statut": "❓", "statut_label": "Non trouvé dans le règlement écrit", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [], "source_manquante": "", "action_recommandee": "" },
    { "titre": "Risques, servitudes et prescriptions particulières", "statut": "🗺️", "statut_label": "À vérifier sur plan graphique", "resume": "...", "regle_principale": "...", "article": "", "page": "", "analyse_detaillee": "...", "citation": "", "points_vigilance": ["..."], "documents_a_consulter": [{"reference": "Annexes SUP", "nom_document": "Servitudes d'utilité publique", "raison": "Vérifier les servitudes et risques affectant la parcelle.", "url": null}], "source_manquante": "Annexes SUP / PPRI", "action_recommandee": "Consulter les annexes du PLU (servitudes d'utilité publique, PPRI) et le Géoportail des risques naturels." }
  ],
  "conclusion_operationnelle": {
    "points_bloquants": ["Contrainte empêchant ou limitant significativement le projet"],
    "conditions": ["Règles applicables sous certaines conditions"],
    "non_applicables": ["Règles identifiées mais non applicables à CE projet"],
    "sujets_a_verifier": ["Points à confirmer auprès de la commune ou par consultation des plans"],
    "opportunites": ["Avantages identifiés dans le règlement pour ce projet"],
    "niveau_risque": "Faible",
    "synthese": "Paragraphe de 100 à 200 mots rédigé pour un investisseur immobilier, résumant les enjeux, obstacles, libertés et prochaines étapes recommandées."
  }
}
</json>`;

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

const FALLBACK_URLS = {
  '200057867_zones': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de-zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
  '200057867_general': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/200057867_4-1-1_Partie1_Definitions_et_dispositions_generales.pdf',
};

const SECTION_TITLES = [
  'Habitation / destination',
  'Mixité sociale / SMS',
  'Taille minimale des logements / STML',
  'Mixité fonctionnelle',
  'Stationnement',
  'Hauteur',
  'Emprise au sol',
  'Espaces verts / pleine terre',
  'Implantation / prospects',
  'Risques, servitudes et prescriptions particulières',
];

// Noms canoniques de repli pour les plans graphiques numérotés.
// Ces libellés sont communs à de nombreux PLU/PLUi mais non universels :
// ils ne s'appliquent que si le nom récupéré depuis l'API GPU est générique.
const PLAN_FALLBACK_NAMES = {
  '1': 'Plan général',
  '2': 'Plan des prescriptions et périmètres particuliers',
  '3': 'Plan des protections patrimoniales, écologiques et paysagères',
  '4': 'Plan de pleine-terre et coefficient de biotope surfacique',
  '5': 'Plan des secteurs de stationnement',
};

// Enrichit les planUrls bruts en ajoutant un num et un nom propre.
// Priorité : nom réel fourni par zone.js (GPU ou IA). Fallback PLAN_FALLBACK_NAMES
// seulement si le nom est générique (ex: "Plan graphique 3" sans titre réel).
function normalizeGpuDocuments(rawPlans) {
  if (!Array.isArray(rawPlans) || !rawPlans.length) return [];
  return rawPlans.map(p => {
    const rawNom = p.nom || '';
    // Extrait le numéro depuis le nom ("Plan 3 — Zonage" → "3") ou l'URL
    const num = rawNom.match(/(?:^plan\s+graphique\s+|^plan\s+)(\d+)/i)?.[1]
             || String(p.url || '').match(/graphique_(\d+)/i)?.[1];
    // Générique = nom sans titre réel : "Plan graphique 3", "Plan graphique", "Plan 3"
    // Ne PAS traiter comme générique : "Règlement graphique — Prescriptions",
    // "Plan 3 — Zonage Saint-Denis", "Zonage Synthèse", etc.
    const isGeneric = /^plan\s+graphique\s*\d*\s*$|^plan\s+\d+\s*$/i.test(rawNom);
    let nom;
    if (!isGeneric && rawNom) {
      nom = rawNom; // vrai nom GPU / IA — on le garde tel quel
    } else if (num && PLAN_FALLBACK_NAMES[num]) {
      nom = `Plan graphique n°${num} — ${PLAN_FALLBACK_NAMES[num]}`;
    } else {
      // Si on détecte seulement un numéro sans libellé fiable, on n'invente pas un titre.
      nom = 'Document graphique — titre non disponible';
    }
    return { nom, url: p.url, num: num || null };
  });
}

// Résout les URLs dans documents_a_consulter en les matchant contre les plans disponibles.
// Double stratégie : par numéro de plan, puis par mots-clés thématiques.
function resolveDocUrls(sections, availablePlans) {
  if (!availablePlans.length) return sections;
  const THEMATIC = [
    { keys: ['prescription', 'périmètre', 'sms', 'stml', 'emplacement', 'hauteur', 'réservé'], planKeys: ['prescription', 'périmètre'] },
    { keys: ['mixité', 'social', 'diversité'], planKeys: ['mixité', 'social', 'diversité'] },
    { keys: ['pleine terre', 'biotope', 'cbs'], planKeys: ['pleine', 'biotope', 'cbs'] },
    { keys: ['stationnement', 'parking'], planKeys: ['stationnement'] },
    { keys: ['patrimoine', 'paysag', 'écolog'], planKeys: ['patrimoine', 'paysag', 'écolog', 'protection'] },
    { keys: ['zonage', 'général', 'general'], planKeys: ['général', 'general', 'zonage', 'synthèse'] },
  ];
  return sections.map(sec => ({
    ...sec,
    documents_a_consulter: (sec.documents_a_consulter || []).map(doc => {
      if (doc.url) return doc;
      const refLower = (String(doc.reference || '') + ' ' + String(doc.nom_document || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      // 1. Match par numéro explicite dans la référence
      const numRef = refLower.match(/n[°o]?\s*(\d+)|graphique\s+(\d+)|plan\s+(\d+)/);
      if (numRef) {
        const n = numRef[1] || numRef[2] || numRef[3];
        const byNum = availablePlans.find(p => p.num === n);
        if (byNum) return { ...doc, url: byNum.url, nom_document: byNum.nom || doc.nom_document };
      }
      // 2. Match thématique
      for (const th of THEMATIC) {
        if (!th.keys.some(k => refLower.includes(k))) continue;
        const matched = availablePlans.find(p => {
          const pn = p.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return th.planKeys.some(k => pn.includes(k));
        });
        if (matched) return { ...doc, url: matched.url, nom_document: matched.nom || doc.nom_document };
      }
      return doc;
    }),
  }));
}

const STATUT_FROM_LABEL = { 'applicable': '✅', 'sous conditions': '⚠️', 'non applicable': '❌', 'à vérifier sur plan graphique': '🗺️', 'non trouvé': '❓', 'non trouvé dans le règlement écrit': '❓' };
const LABEL_FROM_STATUT = { '✅': 'Applicable', '⚠️': 'Sous conditions', '❌': 'Non applicable', '🗺️': 'À vérifier sur plan graphique', '❓': 'Non trouvé dans le règlement écrit' };

function coerceStatut(rawStatut, rawLabel) {
  const s = (rawStatut || '').trim();
  if (LABEL_FROM_STATUT[s]) return { statut: s, statut_label: LABEL_FROM_STATUT[s] };
  const lNorm = (rawLabel || '').toLowerCase().trim();
  if (STATUT_FROM_LABEL[lNorm]) return { statut: STATUT_FROM_LABEL[lNorm], statut_label: rawLabel };
  return { statut: '❓', statut_label: 'Non trouvé dans le règlement écrit' };
}

function normalizeAnalysis(parsed) {
  const defaultSection = titre => ({
    titre,
    statut: '❓',
    statut_label: 'Non trouvé dans le règlement écrit',
    resume: 'Non trouvé dans les extraits.',
    regle_principale: 'Non trouvé dans les extraits.',
    article: '',
    page: '',
    analyse_detaillee: 'Cette section n\'a pas pu être analysée dans les extraits disponibles. Vérifier manuellement dans le règlement écrit et les plans graphiques.',
    citation: '',
    points_vigilance: ['Vérifier manuellement dans le règlement et les plans graphiques.'],
    documents_a_consulter: [],
    source_manquante: '',
    action_recommandee: '',
  });

  const input = Array.isArray(parsed.sections) ? parsed.sections : [];
  const sections = SECTION_TITLES.map(titre => {
    const keyword = titre.split('/')[0].trim().toLowerCase();
    const found = input.find(s => s && s.titre && s.titre.toLowerCase().includes(keyword));
    if (!found) return defaultSection(titre);
    const { statut, statut_label } = coerceStatut(found.statut, found.statut_label);
    return {
      titre,
      statut,
      statut_label,
      resume: found.resume || 'Non trouvé dans les extraits.',
      regle_principale: found.regle_principale || 'Non trouvé dans les extraits.',
      article: found.article || '',
      page: String(found.page || ''),
      analyse_detaillee: found.analyse_detaillee || '',
      citation: found.citation || '',
      points_vigilance: Array.isArray(found.points_vigilance) ? found.points_vigilance.slice(0, 4) : [],
      documents_a_consulter: Array.isArray(found.documents_a_consulter) ? found.documents_a_consulter.slice(0, 3).map(d => ({
        reference: d.reference || '',
        nom_document: d.nom_document || '',
        raison: d.raison || '',
        url: d.url || null,
      })) : [],
      source_manquante: found.source_manquante || '',
      action_recommandee: found.action_recommandee || '',
    };
  });

  const c = parsed.conclusion_operationnelle || {};
  return {
    sections,
    conclusion_operationnelle: {
      points_bloquants: Array.isArray(c.points_bloquants) ? c.points_bloquants : [],
      conditions: Array.isArray(c.conditions) ? c.conditions : [],
      non_applicables: Array.isArray(c.non_applicables) ? c.non_applicables : [],
      sujets_a_verifier: Array.isArray(c.sujets_a_verifier) ? c.sujets_a_verifier : [],
      opportunites: Array.isArray(c.opportunites) ? c.opportunites : [],
      niveau_risque: c.niveau_risque || 'Moyen',
      synthese: c.synthese || '',
    },
  };
}

// Télécharge un PDF en streaming vers /tmp sans accumuler les chunks en mémoire.
// Évite le pic mémoire 2× de Buffer.concat sur les gros règlements.
// Lève PDF_TROP_VOLUMINEUX si content-length ou total réel dépassent maxBytes.
async function streamToTmp(url, tmpPath, maxBytes) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(new Error('timeout 180s')), 180000);
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
  } finally { clearTimeout(tid); }
  if (!response.ok) throw new Error('Téléchargement échoué (' + response.status + ')');
  const cl = parseInt(response.headers.get('content-length') || '0');
  if (cl > maxBytes) {
    try { response.body?.cancel(); } catch(e) {}
    throw new Error('PDF_TROP_VOLUMINEUX:' + Math.round(cl / 1048576));
  }
  const fd = fs.openSync(tmpPath, 'w');
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch(e) {}
        throw new Error('PDF_TROP_VOLUMINEUX:>' + Math.round(maxBytes / 1048576));
      }
      fs.writeSync(fd, Buffer.from(value));
    }
  } finally {
    try { fs.closeSync(fd); } catch(e) {}
  }
  return total;
}

// Extrait le texte d'un buffer PDF
async function extractText(buffer) {
  let pageNum = 0;

  // pagerender : réplique le rendu par défaut de pdf-parse en injectant
  // un marqueur --- PAGE N --- avant chaque page, ce qui permet à Claude
  // de citer les numéros de page réels plutôt que de les inventer.
  const options = {
    pagerender: async function(pageData) {
      pageNum++;
      const textContent = await pageData.getTextContent();
      let lastY = null;
      let text = '';
      for (const item of textContent.items) {
        if (lastY !== null && lastY !== item.transform[5]) text += '\n';
        text += item.str;
        lastY = item.transform[5];
      }
      return `\n--- PAGE ${pageNum} ---\n${text}`;
    }
  };

  const data = await pdfParse(buffer, options);
  let text = data.text || '';
  text = repairTableBlocks(text);
  return text;
}

// Répare les blocs de tableau où pdf-parse a mélangé les colonnes.
// Heuristique : si on voit plusieurs lignes courtes (<60 chars) qui
// forment un pattern "label / nombre / nombre", on les regroupe.
function repairTableBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Détecte une séquence de lignes courtes ressemblant à un tableau
    // (au moins 3 lignes consécutives de moins de 80 chars avec des chiffres)
    const tableLines = [];
    let j = i;
    while (j < lines.length && j < i + 50) {
      const l = lines[j].trim();
      if (l.length === 0) { j++; continue; }
      if (l.length < 80 || /^\d[\d\s,./%-]*$/.test(l) || /\d+\s*(place|logement|m²|%|T\d)/i.test(l)) {
        tableLines.push(l);
        j++;
      } else {
        break;
      }
    }
    if (tableLines.length >= 4) {
      // Regroupe les lignes en groupes de 2-3 pour former des "rangées"
      // et les sépare par des pipes pour les rendre lisibles par l'IA
      out.push(tableLines.join(' | '));
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
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

  const normalizedPlans = normalizeGpuDocuments(planUrls || []);
  const plansInfo = normalizedPlans.length
    ? '\n\nDOCUMENTS GRAPHIQUES DÉJÀ DISPONIBLES — liens directs opérationnels :\n' +
      normalizedPlans.map(p => `- ${p.nom} : ${p.url}`).join('\n') +
      '\n\nRÈGLES DOCUMENTS (impératives) :' +
      '\n1. Si une section nécessite de consulter un plan listé ci-dessus : mets l\'URL EXACTE dans documents_a_consulter[].url — JAMAIS null si le document est dans la liste.' +
      '\n2. Nomme le document avec son titre exact tel qu\'il apparaît dans la liste ci-dessus.' +
      '\n3. Dans analyse_detaillee et points_vigilance, écris "à vérifier dans le plan déjà disponible : [titre exact]" plutôt que "à télécharger sur le Géoportail".' +
      '\n4. Si le document nécessaire n\'est PAS dans la liste ci-dessus : laisse url null et indique "Lien direct non disponible".'
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
    .replace('{PROJET}', projet ? '\nDescription du projet envisagé par le client (raisonne sur CE projet précis, notamment pour l\'applicabilité des règles en ②③④) : ' + String(projet).slice(0, 1500) : '');

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
    const MAX_PDF = PDF_MAX_MB * 1024 * 1024;

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
        const hash = m[1];
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        let r;
        try {
          r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document/${hash}/files`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            signal: ctrl.signal
          });
        } finally { clearTimeout(tid); }
        if (!r.ok) return null;
        const files = await r.json();
        if (!Array.isArray(files) || !files.length) return null;
        console.log(`GPU files (${files.length}):`, files.slice(0, 8).map(f => f.name).join(' ; ').slice(0, 300));
        const base = docUrl.slice(0, docUrl.lastIndexOf('/'));

        // Exclusions claires : graphiques, rapport de présentation, PADD, OAP, annexes non-réglementaires
        const EXCLUDE = /graphique|rapport.pr[ée]sentation|padd|oap|notice|info.surf|sanitaire|assainissement|servitude|sup[_-]/i;
        // Inclusions : tout ce qui ressemble à un règlement écrit
        // Couvre : _reglement_, _reglements_, _reglement-ecrit_, pièce_4_reglement, 4-1-2-1_Reglements...
        const INCLUDE = /r[eè]glement/i;

        const candidates = files
          .filter(f => {
            const n = (f.name || '').toLowerCase();
            return n.endsWith('.pdf') && INCLUDE.test(n) && !EXCLUDE.test(n);
          })
          .map(f => {
            const n = f.name || '';
            // Priorité croissante : pièces ciblées (zone/écrit/secteur/partie) en premier
            const priority = /ecrit|zone|secteur|partie[_\s-]?\d|piece[_\s-]?\d|\d[_-]\d{8}/i.test(n) ? 1
                           : /_\d+_\d{8}/i.test(n) ? 2 : 3;
            return { name: n, title: f.title || '', url: `${base}/${n}`, priority };
          })
          .sort((a, b) => a.priority - b.priority);

        console.log('Candidats règlement:', candidates.length, candidates.slice(0, 3).map(c => c.name).join(' ; '));
        return candidates.length ? candidates : null;
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
      // Mode gros PDF optimisé : streaming vers /tmp (pas d'accumulation de chunks,
      // évite le pic mémoire 2× du Buffer.concat), puis chargement unique du buffer
      // et extraction complète avec marqueurs de pages — même logique réglementaire qu'en mode normal.
      // Note : pdf-parse impose un Buffer complet ; /tmp réduit uniquement le pic download.
      if (lastErr && /PDF_TROP_VOLUMINEUX/.test(lastErr.message)) {
        const tmpPath = '/tmp/plu_large_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.pdf';
        const maxLarge = LARGE_PDF_MAX_MB * 1024 * 1024;
        try {
          console.log('Mode gros PDF optimisé: streaming vers /tmp (plafond ' + LARGE_PDF_MAX_MB + ' Mo)...');
          const bytes = await streamToTmp(pluUrl, tmpPath, maxLarge);
          console.log('PDF dans /tmp:', Math.round(bytes / 1048576), 'Mo — chargement unique du buffer...');
          pdfBuffer = fs.readFileSync(tmpPath);
          lastErr = null;
          console.log('Mode gros PDF optimisé: buffer chargé —', Math.round(pdfBuffer.length / 1048576), 'Mo — extraction complète en cours');
        } catch(e) {
          console.log('Mode gros PDF optimisé échoué:', e.message);
          if (/PDF_TROP_VOLUMINEUX/.test(e.message)) lastErr = e;
        } finally {
          try { fs.unlinkSync(tmpPath); } catch(e) {}
        }
      }
      if (lastErr) {
        if (/PDF_TROP_VOLUMINEUX/.test(lastErr.message)) {
          const sizeStr = (lastErr.message.match(/:>?\s*(\S+)/) || [])[1] || '?';
          console.log('PDF_TROP_VOLUMINEUX final:', sizeStr, 'Mo — renvoie réponse structurée');
          return res.status(200).json({
            success: false,
            error_code: 'PDF_TROP_VOLUMINEUX',
            zone,
            analysisType,
            message: `Le règlement PLU (${sizeStr} Mo) dépasse la capacité d'analyse automatique. Téléchargez-le et uploadez uniquement les pages concernant la zone ${zone}.`,
            reglement_url: pluUrl,
            documents_disponibles: normalizedPlans,
          });
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
      'mixit[ée]\\s+sociale|logements?\\s+(?:locatifs?\\s+)?sociaux|logement\\s+social\\b|' +
      'part\\s+minimale\\s+de\\s+logements?\\s+sociaux|pourcentage\\s+de\\s+logements?\\s+sociaux|' +
      'emplacement\\s+r[ée]serv[ée]\\s+(?:au\\s+titre\\s+de\\s+la\\s+)?mixit[ée]|' +
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
      '\\bT3\\b|\\bT3\\+\\b|type\\s+3|logements?\\s+T[2-5]|' +
      '65\\s*%|quota\\s+(?:de\\s+)?logements?|programmes?\\s+de\\s+logements?|' +
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

    // 4. HAUTEUR — gabarit, Hmax, R+N, niveaux
    const hauteurSection = extractTopicSections(fullText,
      'hauteur\\s+(?:maximale?|des\\s+constructions|plafond|limit[ée]e?)|' +
      '\\bHmax\\b|\\bH\\s*max\\b|hauteur\\s+absolue|hauteur\\s+totale|' +
      'plafond\\s+de\\s+hauteur|gabarit|r[ée]glementation\\s+des\\s+hauteurs|' +
      '\\bR\\s*\\+\\s*\\d|rez-de-chauss[ée]e\\s*\\+\\s*\\d|nombre\\s+d[e\']?[ée]tages?|' +
      'couronnement|acrot[eè]re|fa[îi]tage',
      12000);

    // 5. EMPRISE AU SOL + PLEINE TERRE — CES, COS, espaces verts, perméabilité
    const empriseSection = extractTopicSections(fullText,
      'emprise\\s+au\\s+sol|coefficient\\s+d[e\']?(?:emprise|occupation|utilisation)|' +
      '\\bCES\\b|\\bCOS\\b|\\bCUF\\b|\\bSEP\\b|' +
      'pleine\\s+terre|pleine-terre|espace(?:s)?\\s+(?:verts?|lib[rs]es?|perméables?|non[\\s-]imperméabilis[ée]s?)|' +
      'coefficient\\s+(?:bio|vert|nature|perméabilité|biotope)|\\bCBS\\b|' +
      'surface\\s+(?:perméable|végétalis[ée]|non[\\s-]imperméabilis[ée])|' +
      'imperméabilis(?:ation|[ée])|végétalisa(?:tion|[ée])',
      12000);

    // 6. STATIONNEMENT — normes, places, vélos, S1/S2/S3/S4
    const statSection = extractTopicSections(fullText,
      'stationnement|aires?\\s+de\\s+stationnement|places?\\s+de\\s+(?:parking|stationnement)|' +
      'normes?\\s+de\\s+stationnement|besoins?\\s+en\\s+stationnement|' +
      'nombre\\s+de\\s+places?|ratio\\s+de\\s+stationnement|' +
      '\\bS1\\b|\\bS2\\b|\\bS3\\b|\\bS4\\b|' +
      'stationnement\\s+(?:des?\\s+)?v[eé]los?|parc(?:s)?\\s+v[eé]los?|local\\s+v[eé]los?',
      16000);

    // 7. IMPLANTATION / PROSPECTS — reculs, limites séparatives, bande constructible
    const implantSection = extractTopicSections(fullText,
      'implantation|prospect|recul|retrait|limite\\s+séparat|' +
      'bande\\s+constructible|alignement\\s+(?:sur|à|de\\s+la\\s+voie)|' +
      'front\\s+(?:de\\s+)?b[aâ]ti|distance\\s+(?:minimale?|aux?|par\\s+rapport)|' +
      'marge\\s+de\\s+recul|retrait\\s+(?:par\\s+rapport|de\\s+la)',
      12000);

    // Déduplication : n'ajoute une section que si son contenu n'est pas déjà dans sendText.
    // BUG CORRIGÉ : section.slice(2000,2400)="" pour sections < 2000 chars → "".includes("")=true
    // → section silencieusement ignorée. Fix : toujours ajouter les sections courtes.
    function addIfNew(existing, section) {
      if (!section) return false;
      if (section.length < 2000) return true; // section courte → toujours inclure
      const probe = section.slice(2000, 2400);
      return !probe || !existing.includes(probe);
    }

    async function callClaude(promptText) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
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
    const topicsDebug = { sections_found: [], sections_missing: [], sections_included: [] };
    for (const { label, key, section } of [
      { label: 'MIXITÉ SOCIALE / LOGEMENTS SOCIAUX',           key: 'SMS',           section: mixiteSection },
      { label: 'TAILLE MINIMALE / TYPOLOGIE DES LOGEMENTS',    key: 'STML',          section: tailleSection },
      { label: 'MIXITÉ FONCTIONNELLE / LINÉAIRES COMMERCIAUX', key: 'MIXFONC',       section: mixiteFoncSection },
      { label: 'HAUTEUR / GABARIT',                            key: 'HAUTEUR',       section: hauteurSection },
      { label: 'EMPRISE AU SOL / PLEINE TERRE / ESPACES VERTS',key: 'EMPRISE_CBS',   section: empriseSection },
      { label: 'STATIONNEMENT',                                key: 'STATIONNEMENT', section: statSection },
      { label: 'IMPLANTATION / PROSPECTS',                     key: 'IMPLANTATION',  section: implantSection },
    ]) {
      if (!section) { topicsDebug.sections_missing.push(key); continue; }
      topicsDebug.sections_found.push(key);
      if (!addIfNew(sendText, section)) {
        topicsDebug.sections_included.push(key + ':déjà_dans_zone');
        console.log('Section', label, ': déjà couverte par la section de zone');
        continue;
      }
      sendText += '\n\n--- ' + label + ' ---\n\n' + section;
      topicsDebug.sections_included.push(key + ':ajouté');
      console.log('Section', label, 'ajoutée:', section.length, 'chars');
    }

    console.log('topics_debug:', JSON.stringify(topicsDebug));
    console.log('Texte envoyé:', sendText.length, 'chars');

    const fullPrompt = 'Voici les extraits du règlement PLU pour la zone "' + zone + '".\n\nRÈGLE ABSOLUE : ne cite et n\'utilise QUE les dispositions présentes dans les extraits ci-dessous.\n\n' + sendText + '\n\n---\n\n' + prompt;

    let analysisText = await callClaude(fullPrompt);
    console.log('✓ Analyse OK');

    let analysisData = null;
    try {
      // Accepte <json>…</json> ou ```json … ``` (les deux formats que Claude peut produire)
      const jsonMatch = analysisText.match(/<json>([\s\S]*?)<\/json>/)
        || analysisText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1].trim());
        const normalized = normalizeAnalysis(parsed);
        // Résolution des URLs dans documents_a_consulter : si Claude a mis url: null
        // mais que le plan est dans la liste des plans disponibles, on injecte l'URL réelle.
        normalized.sections = resolveDocUrls(normalized.sections, normalizedPlans);
        analysisData = normalized;
      }
    } catch (e) {
      console.log('JSON parsing failed:', e.message);
    }

    if (!analysisData) {
      return res.status(200).json({ success: true, zone, analysisType, raw: analysisText, topics_debug: topicsDebug });
    }
    return res.status(200).json({ success: true, zone, analysisType, ...analysisData, topics_debug: topicsDebug });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
