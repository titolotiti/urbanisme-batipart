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

    // ─── 4. Fallback DB — uniquement Paris (cas particulier) ───
    // Pour toutes les autres communes, APICarto gère automatiquement
    if (!pluUrl && citycode === '75056') {
      pluUrl = 'https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf';
      pluName = 'PLU Paris bioclimatique — 16-19/12/2025';
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
