import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

// ═══════════════════════════════════════════════════
// Labellisation des plans graphiques — UNIVERSEL (tous PLU/PLUi)
// Lit la 1ère page de chaque plan PDF et extrait le titre réel
// (ex: "6.13 Plan mixité sociale") au lieu de "Plan graphique N"
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// API GPU officielle : liste des pièces d'un document AVEC leurs titres
// GET /api/document/{hash}/files → [{name, title, path}]
// Source prioritaire pour nommer les plans — zéro téléchargement de PDF
// ═══════════════════════════════════════════════════
async function fetchGpuFiles(hash) {
  if (!hash) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document/${hash}/files`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!r.ok) { console.log('GPU files API status:', r.status); return null; }
    const d = await r.json();
    if (Array.isArray(d) && d.length) console.log('GPU files sample:', JSON.stringify(d.slice(0, 3)));
    return Array.isArray(d) && d.length ? d : null;
  } catch (e) { console.log('GPU files API err:', e.message); return null; }
}

// Construit les planUrls depuis la liste API GPU (titres officiels)
function plansFromGpuFiles(files, base) {
  const plans = files.filter(f => /graphique/i.test(f.name || ''));
  if (!plans.length) return null;
  const result = plans.map(f => {
    const n = f.name.match(/graphique_(\d+)/)?.[1];
    let title = (f.title || '').trim();
    if (!title || /\.pdf$/i.test(title)) title = (f.path || '').trim(); // fallback sur le répertoire
    if (!title || /\.pdf$/i.test(title)) title = '';
    // Fallback : partie descriptive du nom de fichier
    // ex: "200057867_reglement_graphique_zonage_Saint-Denis_20251216.pdf" → "zonage Saint-Denis"
    if (!title) {
      const mid = f.name.replace(/^\d+_(reglement_)?graphique_?/i, '').replace(/_?\d{8}\.pdf$/i, '').replace(/\.pdf$/i, '').replace(/^\d+_?/, '').replace(/_/g, ' ').trim();
      if (mid && !/^\d*$/.test(mid)) title = mid;
    }
    const nom = title
      ? (n ? `Plan ${n} — ${title.slice(0, 90)}` : title.slice(0, 90))
      : `Plan graphique ${n || ''}`.trim();
    return { nom, url: `${base}/${f.name}`, n: parseInt(n || '999') };
  });
  result.sort((a, b) => a.n - b.n);
  return result.map(({ nom, url }) => ({ nom, url }));
}

// ═══════════════════════════════════════════════════
// Filtrage par commune (PLUi) — universel
// API GPU grid/{code}/children → liste officielle des communes du territoire
// On garde : plans de la commune de l'adresse + plans sans commune (thématiques)
// ═══════════════════════════════════════════════════
function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_']/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchTerritoryCommunes(codgeo) {
  if (!codgeo || codgeo.length <= 5) return null; // PLU communal → pas de filtrage
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/grid/${codgeo}/children`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d.map(g => g.title).filter(Boolean) : null;
  } catch (e) { console.log('GPU children err:', e.message); return null; }
}

function filterPlansByCommune(plans, communeName, allCommunes) {
  if (!communeName || !plans?.length || !allCommunes?.length) return plans;
  const cur = normName(communeName);
  if (!cur) return plans;
  const others = allCommunes.map(normName).filter(c => c && c !== cur);
  const mentionsCur = p => {
    const nn = normName(p.nom);
    if (!nn.includes(cur)) return false;
    // Évite "Saint-Denis" qui matcherait "L'Île-Saint-Denis"
    return !others.some(o => o.includes(cur) && nn.includes(o));
  };
  const mentionsOther = p => { const nn = normName(p.nom); return others.some(o => nn.includes(o)); };
  // Si aucun plan ne mentionne la commune → les noms ne contiennent pas l'info, on garde tout
  if (!plans.some(mentionsCur)) return plans;
  const filtered = plans.filter(p => mentionsCur(p) || !mentionsOther(p));
  console.log(`Filtrage commune "${communeName}": ${plans.length} → ${filtered.length} plans`);
  return filtered;
}

function pickTitle(text) {
  const lines = (text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length >= 4);
  const head = lines.slice(0, 12);
  const isNoise = l => /dossier d.approbation|conseil de territoire|approuv[ée]|enqu[êe]te publique|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^page \d/i.test(l);
  // 1. Ligne numérotée type "6.13 Plan mixité sociale" ou "6.3.d Secteur de plan masse"
  let t = head.find(l => !isNoise(l) && /^\d+(\.\d+)*(\.[a-z])?\s*[-–—:.]?\s+\D/.test(l) && l.length <= 120);
  // 2. Ligne avec mot-clé urbanisme
  if (!t) t = head.find(l => !isNoise(l) && /\b(plan|zonage|mixit|emplacement|hauteur|secteur|patrimoine|risque|servitude|stationnement|espace|prescription|lin[ée]aire)\w*/i.test(l) && l.length >= 8 && l.length <= 120);
  // 3. Première ligne raisonnable
  if (!t) t = head.find(l => !isNoise(l) && l.length >= 10 && l.length <= 120);
  return t ? t.slice(0, 90) : null;
}

async function fetchPlanTitle(url, headers) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const size = parseInt(r.headers.get('content-length') || '0');
    if (size > 15 * 1024 * 1024) return null; // trop lourd → on garde le nom générique
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return null;
    const data = await pdfParse(buf, { max: 1 }); // 1ère page seulement
    return pickTitle(data.text);
  } catch (e) { return null; }
}

async function labelPlans(plans, headers) {
  if (!plans?.length) return;
  // Par lots de 2 + pause 250ms pour ne pas se faire couper par le serveur IGN
  for (let i = 0; i < plans.length; i += 2) {
    const batch = plans.slice(i, i + 2);
    await Promise.all(batch.map(async p => {
      const title = await fetchPlanTitle(p.url, headers);
      const n = p.url.match(/graphique_(\d+)_/)?.[1];
      if (title) p.nom = (n ? `Plan ${n} — ` : '') + title;
      console.log(`Label plan ${n || '?'}: ${title || '(titre non extractable, nom générique conservé)'}`);
    }));
    if (i + 2 < plans.length) await new Promise(r => setTimeout(r, 250));
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse manquante' });

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, */*',
  };

  function fmtDate(url) {
    const m = url?.match(/_(\d{8})\.pdf$/i);
    if (!m) return '';
    const d = m[1];
    return ` — ${d.slice(6)}/${d.slice(4,6)}/${d.slice(0,4)}`;
  }

  // ═══════════════════════════════════════════════════
  // Construit les URLs depuis les props APICarto document
  // APICarto retourne : id (hash), name ("92051_PLU_20210629"), grid_name ("92051")
  // C'est la source principale — fonctionne pour TOUTES les communes
  // ═══════════════════════════════════════════════════
  async function buildUrlsFromDocProps(props) {
    const hash = props.id || props.gpu_doc_id;
    const name = props.name; // ex: "92051_PLU_20210629" ou "200057867_PLUi_20251216"
    const codgeo = props.grid_name || name?.match(/^(\d+)_/)?.[1];
    const date = name?.match(/(\d{8})$/)?.[1];
    if (!hash || !codgeo || !date) return {};
    const base = `https://data.geopf.fr/annexes/gpu/documents/DU_${codgeo}/${hash}`;

    // SOURCE PRIORITAIRE : API GPU /files — liste exacte des plans avec titres officiels
    // Universel (tous PLU/PLUi), zéro téléchargement, zéro rate limiting
    const gpuFiles = await fetchGpuFiles(hash);
    const gpuPlans = gpuFiles ? plansFromGpuFiles(gpuFiles, base) : null;
    if (gpuPlans?.length) {
      console.log('Plans via API GPU files:', gpuPlans.length);
      return {
        pluUrl: `${base}/${codgeo}_reglement_${date}.pdf`,
        zonageUrl: gpuPlans[0]?.url || null,
        planUrls: gpuPlans,
        pluName: `${props.du_type || 'PLU'} ${props.grid_title || ''}` + fmtDate(`${base}/${codgeo}_reglement_${date}.pdf`),
      };
    }

    // FALLBACK : détection par HEAD si l'API GPU ne répond pas
    // Détection fiable : HEAD + vérification Content-Type application/pdf
    // Timeout 5s pour éviter les blocages
    // Test plans 1-10 par lots de 3 pour éviter le rate limiting IGN
    const planUrls = [];
    for (let batch = 0; batch < 4; batch++) {
      const ns = [batch*3+1, batch*3+2, batch*3+3].filter(n => n <= 10);
      const batchResults = await Promise.all(ns.map(async n => {
        const url = `${base}/${codgeo}_reglement_graphique_${n}_${date}.pdf`;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const r = await fetch(url, { method: 'HEAD', headers: H, signal: controller.signal });
          clearTimeout(timeout);
          console.log(`Plan ${n}: status=${r.status}`);
          return r.ok ? { nom: `Plan graphique ${n} — ${props.grid_title || codgeo}`, url } : null;
        } catch(e) { console.log(`Plan ${n}: ${e.message}`); return null; }
      }));
      planUrls.push(...batchResults.filter(Boolean));
      if (batch < 3) await new Promise(r => setTimeout(r, 300)); // 300ms entre lots
    }
    console.log('Plans valides:', planUrls.length);

    return {
      pluUrl: `${base}/${codgeo}_reglement_${date}.pdf`,
      zonageUrl: planUrls[0]?.url || null,
      planUrls,
      pluName: `${props.du_type || 'PLU'} ${props.grid_title || ''}` + fmtDate(`${base}/${codgeo}_reglement_${date}.pdf`),
    };
  }

  try {
    // ─── 1. Géocodage ───
    const geoR = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`
    );
    const geoD = await geoR.json();
    if (!geoD.features?.length) return res.status(404).json({ error: 'Adresse non trouvée' });

    const feat = geoD.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const label = feat.properties.label;
    const city = feat.properties.city || '';
    let citycode = feat.properties.citycode;
    if (citycode.startsWith('751')) citycode = '75056';
    if (citycode.startsWith('692')) citycode = '69123';
    if (citycode.startsWith('132')) citycode = '13055';

    const geomStr = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

    // ─── 2. Zone PLU — avec retry si APICarto répond vide ───
    let zone = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const zR = await fetch(
          `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geomStr)}`,
          { headers: H }
        );
        const zD = await zR.json();
        if (zD.features?.length) {
          const p = zD.features[0].properties;
          zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g, '');
          if (zone) break; // zone trouvée → on arrête
        }
        if (!zone && attempt < 3) {
          console.log(`Zone vide tentative ${attempt}, retry...`);
          await new Promise(r => setTimeout(r, 500)); // attend 500ms
        }
      } catch(e) { console.log('Zone err:', e.message); }
    }

    // ─── 3. Document PLU ───
    let pluUrl = null, pluName = null, zonageUrl = null, partition = null, planUrls = [];

    // SOURCE A : APICarto document (primary)
    // Retourne id (hash), name (partition+date), grid_name (codgeo)
    try {
      const dR = await fetch(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const dD = await dR.json();
      if (dD.features?.length) {
        // Traite TOUS les features — APICarto peut retourner plusieurs documents
        for (const feat of dD.features) {
          const props = feat.properties;
          const nm = (props.name || '').toLowerCase();

          // Plan graphique → extrait directement depuis le nom du document
          if (nm.includes('graphique') || nm.includes('zonage')) {
            const h = props.id || props.gpu_doc_id;
            const cg = props.grid_name || props.name?.match(/^(\d+)_/)?.[1];
            const dt = props.name?.match(/(\d{8})$/)?.[1];
            if (h && cg && dt) {
              const planUrl = `https://data.geopf.fr/annexes/gpu/documents/DU_${cg}/${h}/${props.name}.pdf`;
              const n = props.name?.match(/graphique_(\d+)/)?.[1] || planUrls.length + 1;
              planUrls.push({ nom: `Plan graphique ${n}`, url: planUrl });
            }
            continue;
          }
        }

        // Règlement : prend le premier feature non-graphique
        const mainProps = dD.features.find(f => {
          const nm = (f.properties?.name || '').toLowerCase();
          return !nm.includes('graphique') && !nm.includes('zonage');
        })?.properties || dD.features[0].properties;

        partition = mainProps.name || mainProps.partition || null;
        console.log('APICarto doc props:', JSON.stringify(mainProps));
        const urls = await buildUrlsFromDocProps(mainProps);
        if (urls.pluUrl) {
          pluUrl = urls.pluUrl;
          pluName = urls.pluName;
          zonageUrl = urls.zonageUrl;
          // Fusionne les plans trouvés dans features + ceux de buildUrlsFromDocProps
          // Le titre officiel (API GPU) remplace toujours un nom générique existant
          const headPlans = urls.planUrls || [];
          const byUrl = new Map(planUrls.map(p => [p.url, p]));
          for (const p of headPlans) {
            const existing = byUrl.get(p.url);
            if (existing) {
              if (!/^Plan graphique\b/.test(p.nom)) existing.nom = p.nom; // titre officiel prioritaire
            } else { planUrls.push(p); byUrl.set(p.url, p); }
          }

          console.log('✓ Source: APICarto →', pluUrl, '| Plans:', planUrls.length);
        }
      }
    } catch(e) { console.log('APICarto doc err:', e.message); }

    // SOURCE B : WFS Géoportail (fallback si APICarto ne retourne rien)
    // Interroge directement la base officielle IGN — toujours à jour
    if (!pluUrl && partition) {
      try {
        const wfsUrl = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
          `&TYPENAMES=wfs_du:doc_urba&OUTPUTFORMAT=application/json&COUNT=10` +
          `&CQL_FILTER=partition='${encodeURIComponent(partition)}'`;
        const wR = await fetch(wfsUrl, { headers: H });
        const wD = await wR.json();
        console.log('WFS response:', JSON.stringify(wD).slice(0, 300));
        if (wD.features?.length) {
          const docs = wD.features.map(f => f.properties);
          const u = d => d.href || d.url || d.download || '';
          const reg = docs.find(d => u(d).match(/reglement(?!.*graphique).*\.pdf$/i))
                   || docs.find(d => u(d).endsWith('.pdf') && !u(d).match(/graphique|rapport|padd/i));
          const url = reg ? u(reg) : null;
          if (url) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ Source: WFS Géoportail →', pluUrl);
          }
        }
      } catch(e) { console.log('WFS err:', e.message); }
    }

    // SOURCE B2 : WFS par codcom si partition échoue
    if (!pluUrl) {
      try {
        const wfsUrl = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
          `&TYPENAMES=wfs_du:doc_urba&OUTPUTFORMAT=application/json&COUNT=10` +
          `&CQL_FILTER=codcom='${citycode}'&sortBy=datval+D`;
        const wR = await fetch(wfsUrl, { headers: H });
        const wD = await wR.json();
        console.log('WFS codcom response:', JSON.stringify(wD).slice(0, 300));
        if (wD.features?.length) {
          const docs = wD.features.map(f => f.properties);
          const u = d => d.href || d.url || d.download || '';
          const reg = docs.find(d => u(d).match(/reglement(?!.*graphique).*\.pdf$/i))
                   || docs.find(d => u(d).endsWith('.pdf') && !u(d).match(/graphique|rapport|padd/i));
          const url = reg ? u(reg) : null;
          if (url) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ Source: WFS codcom →', pluUrl);
          }
        }
      } catch(e) { console.log('WFS codcom err:', e.message); }
    }

    // ─── 4. Fallback DB ───
    // PLUi intercommunaux IDF — codes INSEE officiels vérifiés
    if (!pluUrl) {
      const GPSO = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057974/da0d24dad863b8b32a2323bc49cd389e/200057974_reglement_20251202.pdf', 'PLUi Grand Paris Seine Ouest — 02/12/2025'];
      const BNS  = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057990/35b89739df91562887f9e4623801ace5/200057990_reglement_20260217.pdf', 'PLUi Boucle Nord de Seine — 17/02/2026'];
      const PC   = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057867/9ac270d37a778fa1bed02998270ab1b3/200057867_reglement_20251216.pdf', 'PLUi Plaine Commune — 16/12/2025'];
      const EE   = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057875/b57af8c53d37c5c6308bbf07bdb1db87/200057875_reglement_20250624.pdf', 'PLUi Est Ensemble — 24/06/2025'];
      const VS   = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057966/7062c937f56c7f4103879338ed3e6499/200057966_reglement_20250430.pdf', 'PLUi Vallée Sud Grand Paris — 30/04/2025'];

      const DB = {
        // ── Paris ──
        '75056': ['https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf', 'PLU Paris bioclimatique — 16-19/12/2025'],
        // ── PLUi GPSO (8 communes) — codes INSEE corrects ──
        '92012':GPSO, // Boulogne-Billancourt
        '92022':GPSO, // Chaville
        '92040':GPSO, // Issy-les-Moulineaux
        '92047':GPSO, // Marnes-la-Coquette
        '92048':GPSO, // Meudon
        '92072':GPSO, // Sèvres
        '92075':GPSO, // Vanves
        '92077':GPSO, // Ville-d'Avray
        // ── PLUi Boucle Nord de Seine (7 communes) ──
        '92004':BNS, // Asnières-sur-Seine
        '92009':BNS, // Bois-Colombes
        '92024':BNS, // Clichy
        '92025':BNS, // Colombes
        '92036':BNS, // Gennevilliers
        '92078':BNS, // Villeneuve-la-Garenne
        '95018':BNS, // Argenteuil
        // ── PLUi Plaine Commune (9 communes) — codes INSEE corrects ──
        '93001':PC, // Aubervilliers
        '93027':PC, // La Courneuve
        '93031':PC, // Épinay-sur-Seine
        '93039':PC, // L'Île-Saint-Denis
        '93059':PC, // Pierrefitte-sur-Seine
        '93066':PC, // Saint-Denis
        '93070':PC, // Saint-Ouen-sur-Seine
        '93072':PC, // Stains
        '93079':PC, // Villetaneuse
        // ── PLUi Est Ensemble (9 communes) ──
        '93006':EE, // Bagnolet
        '93008':EE, // Bobigny
        '93010':EE, // Bondy
        '93045':EE, // Les Lilas
        '93048':EE, // Montreuil
        '93053':EE, // Noisy-le-Sec
        '93055':EE, // Pantin
        '93061':EE, // Le Pré-Saint-Gervais
        '93063':EE, // Romainville
        // ── PLUi Vallée Sud Grand Paris (11 communes) ──
        '92002':VS, // Antony
        '92007':VS, // Bagneux
        '92014':VS, // Bourg-la-Reine
        '92019':VS, // Châtenay-Malabry
        '92020':VS, // Châtillon
        '92023':VS, // Clamart
        '92032':VS, // Fontenay-aux-Roses
        '92046':VS, // Malakoff
        '92049':VS, // Montrouge
        '92060':VS, // Le Plessis-Robinson
        '92071':VS, // Sceaux
        // ── PLU communaux ──
        '92051':['https://data.geopf.fr/annexes/gpu/documents/DU_92051/e6c8855ff88ca1b7823c688132f2d6f1/92051_reglement_20210629.pdf','PLU Neuilly-sur-Seine — 29/06/2021'],
        '92073':['https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf','PLU Suresnes — 26/06/2024'],
        '94037':['https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf','PLU Gentilly — 12/03/2024'],
      };

      const entry = DB[citycode];
      if (entry) { [pluUrl, pluName] = entry; console.log('✓ DB fallback:', citycode); }
    }

    // ── Détection plans graphiques si pas encore trouvés (fallback DB/WFS) ──
    if (planUrls.length === 0 && pluUrl) {
      const urlMatch = pluUrl.match(/DU_([^/]+)\/([^/]+)\/([^/]+)_(\d{8})\.pdf/);
      if (urlMatch) {
        const [, du, hash, , date2] = urlMatch;
        const cg = du;
        const base2 = `https://data.geopf.fr/annexes/gpu/documents/DU_${cg}/${hash}`;
        // 1. API GPU files (titres officiels)
        const gpuFiles2 = await fetchGpuFiles(hash);
        const gpuPlans2 = gpuFiles2 ? plansFromGpuFiles(gpuFiles2, base2) : null;
        if (gpuPlans2?.length) {
          planUrls = gpuPlans2;
          console.log('Plans (fallback API GPU):', planUrls.length);
        } else {
        // 2. Sinon HEAD probing par lots de 3 + pause 300ms
        for (let batch = 0; batch < 4; batch++) {
          const ns = [batch*3+1, batch*3+2, batch*3+3].filter(n => n <= 10);
          const batchResults = await Promise.all(ns.map(async n => {
            const url = `${base2}/${cg}_reglement_graphique_${n}_${date2}.pdf`;
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 5000);
              const r = await fetch(url, { method: 'HEAD', headers: H, signal: controller.signal });
              clearTimeout(timeout);
              return r.ok ? { nom: `Plan graphique ${n}`, url } : null;
            } catch(e) { return null; }
          }));
          planUrls.push(...batchResults.filter(Boolean));
          if (batch < 3) await new Promise(r => setTimeout(r, 300));
        }
        console.log('Plans (fallback détection HEAD):', planUrls.length);
        }
      }
    }

    // ── Filtrage par commune (PLUi) : ne garder que les plans de la commune
    //    de l'adresse + les plans thématiques (sans commune dans le nom) ──
    const duCode = (pluUrl || '').match(/DU_(\d+)\//)?.[1];
    let territoryCommunes = null;
    if (planUrls.length > 1 && duCode) {
      territoryCommunes = await fetchTerritoryCommunes(duCode);
      if (territoryCommunes?.length) planUrls = filterPlansByCommune(planUrls, city, territoryCommunes);
    }

    // ── Labellisation pdf-parse : SEULEMENT pour les plans restés sans titre
    //    officiel, max 12 pour ne pas exploser le timeout ──
    const unnamed = planUrls.filter(p => /^Plan graphique\b/.test(p.nom || '')).slice(0, 12);
    if (unnamed.length) await labelPlans(unnamed, H);

    // ── Re-filtrage après labellisation (les titres extraits des PDF peuvent
    //    contenir le nom de la commune) ──
    if (unnamed.length && territoryCommunes?.length) {
      planUrls = filterPlansByCommune(planUrls, city, territoryCommunes);
    }

    // ── PPRI : vérification zone inondable via Géorisques ──
    let ppri = null;
    if (lat && lon) {
      try {
        const geoR = await fetch(
          `https://georisques.gouv.fr/api/v1/gaspar/ppr?rayon=1000&latlon=${lon},${lat}&page=1&page_size=20`,
          { headers: H }
        );
        if (geoR.ok) {
          const geoD = await geoR.json();
          const inondation = (geoD.data || []).find(p =>
            p.type_risque_jo?.toLowerCase().includes('inond') ||
            p.libelle_risque_jo?.toLowerCase().includes('inond')
          );
          if (inondation) {
            ppri = {
              nom: inondation.libelle_ppr || inondation.libelle_risque_jo || 'PPRI',
              statut: inondation.etat_ppr || null
            };
          }
        }
      } catch(e) { console.log('PPRI err:', e.message); }
    }

    console.log('FINAL:', { citycode, zone, partition, found: !!pluUrl, ppri });
    return res.status(200).json({
      success: true, address: label,
      coordinates: { lat, lon },
      citycode, zone, partition,
      pluUrl, pluName, zonageUrl, planUrls,
      ppri
    });

  } catch(err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: err.message });
  }
}
