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
  function buildUrlsFromDocProps(props) {
    const hash = props.id || props.gpu_doc_id;
    const name = props.name; // ex: "92051_PLU_20210629" ou "200057867_PLUi_20251216"
    const codgeo = props.grid_name || name?.match(/^(\d+)_/)?.[1];
    const date = name?.match(/(\d{8})$/)?.[1];
    if (!hash || !codgeo || !date) return {};
    const base = `https://data.geopf.fr/annexes/gpu/documents/DU_${codgeo}/${hash}`;
    return {
      pluUrl: `${base}/${codgeo}_reglement_${date}.pdf`,
      zonageUrl: `${base}/${codgeo}_reglement_graphique_1_${date}.pdf`,
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

    // ─── 2. Zone PLU ───
    let zone = null;
    try {
      const zR = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const zD = await zR.json();
      if (zD.features?.length) {
        const p = zD.features[0].properties;
        zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g, '');
      }
    } catch(e) { console.log('Zone err:', e.message); }

    // ─── 3. Document PLU via APICarto document avec GEOMETRY ───
    // Retourne id (hash), name (partition+date), grid_name (codgeo)
    // → permet de construire l'URL data.geopf.fr pour N'IMPORTE quelle commune
    let pluUrl = null, pluName = null, zonageUrl = null, partition = null;

    try {
      const dR = await fetch(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const dD = await dR.json();
      if (dD.features?.length) {
        const props = dD.features[0].properties;
        partition = props.name || props.partition || null;
        console.log('APICarto doc:', JSON.stringify(props));

        const urls = buildUrlsFromDocProps(props);
        if (urls.pluUrl) {
          pluUrl = urls.pluUrl;
          pluName = urls.pluName;
          zonageUrl = urls.zonageUrl;
          console.log('✓ URL auto:', pluUrl);
        }
      }
    } catch(e) { console.log('Doc err:', e.message); }

    // ─── 4. Fallback DB ───
    // Pour Paris et les PLUi intercommunaux (APICarto ne retourne pas le hash pour ces territoires)
    if (!pluUrl) {
      const GPSO = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057974/da0d24dad863b8b32a2323bc49cd389e/200057974_reglement_20251202.pdf', 'PLUi Grand Paris Seine Ouest — 02/12/2025'];
      const BNS  = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057990/35b89739df91562887f9e4623801ace5/200057990_reglement_20260217.pdf', 'PLUi Boucle Nord de Seine — 17/02/2026'];
      const PC   = ['https://data.geopf.fr/annexes/gpu/documents/DU_200057867/9ac270d37a778fa1bed02998270ab1b3/200057867_reglement_20251216.pdf', 'PLUi Plaine Commune — 16/12/2025'];
      const DB = {
        '75056': ['https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf', 'PLU Paris — 16-19/12/2025'],
        // PLUi GPSO
        '92012':GPSO,'92022':GPSO,'92040':GPSO,'92046':GPSO,
        '92049':GPSO,'92072':GPSO,'92073':GPSO,'92079':GPSO,
        // PLUi Boucle Nord de Seine
        '92004':BNS,'92009':BNS,'92024':BNS,'92025':BNS,
        '92036':BNS,'92078':BNS,'95018':BNS,
        // PLUi Plaine Commune
        '93001':PC,'93027':PC,'93029':PC,'93037':PC,
        '93059':PC,'93066':PC,'93068':PC,'93070':PC,'93078':PC,
        // PLU communaux
        '92051':['https://data.geopf.fr/annexes/gpu/documents/DU_92051/e6c8855ff88ca1b7823c688132f2d6f1/92051_reglement_20210629.pdf','PLU Neuilly-sur-Seine — 29/06/2021'],
        '92075':['https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf','PLU Suresnes — 26/06/2024'],
        '94037':['https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf','PLU Gentilly — 12/03/2024'],
      };
      const entry = DB[citycode];
      if (entry) { [pluUrl, pluName] = entry; console.log('✓ DB fallback:', citycode); }
    }

    console.log('FINAL:', { citycode, zone, partition, found: !!pluUrl });
    return res.status(200).json({
      success: true, address: label,
      coordinates: { lat, lon },
      citycode, zone, partition,
      pluUrl, pluName, zonageUrl
    });

  } catch(err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: err.message });
  }
}
