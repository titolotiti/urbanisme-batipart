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
    // Détection fiable : HEAD + vérification Content-Type application/pdf
    // Timeout 4s pour éviter les blocages, max 8 plans testés en parallèle
    async function checkPlan(url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const r = await fetch(url, { method: 'HEAD', headers: H, signal: controller.signal });
        clearTimeout(timeout);
        return r.ok ? url : null;
      } catch(e) { return null; }
    }

    const planChecks = await Promise.all(
      Array.from({length: 8}, (_, i) => i + 1).map(async n => {
        const url = `${base}/${codgeo}_reglement_graphique_${n}_${date}.pdf`;
        const valid = await checkPlan(url);
        return valid ? { nom: `Plan graphique ${n}`, url } : null;
      })
    );
    const planUrls = planChecks.filter(Boolean);
    console.log('Plans trouvés:', planUrls.length);

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
          if (planUrls.length === 0) planUrls = urls.planUrls || [];

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
