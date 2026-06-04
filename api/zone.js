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

    // ─── 2. Zone PLU ───
    let zone = null, partition = null;
    try {
      const zR = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const zD = await zR.json();
      if (zD.features?.length) {
        const p = zD.features[0].properties;
        zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g,'');
      }
    } catch(e) { console.log('Zone err:', e.message); }

    // ─── 3. Récupérer le document PLU ───
    // APICarto /api/gpu/document avec geometry → retourne la vraie partition
    let docPartition = null, docProps = null;
    try {
      const dR = await fetch(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const dD = await dR.json();
      if (dD.features?.length) {
        docProps = dD.features[0].properties;
        docPartition = docProps.partition || null;
        console.log('APICarto document props:', JSON.stringify(docProps));
      }
    } catch(e) { console.log('Document err:', e.message); }

    partition = docPartition;

    // ─── 4. Trouver l'URL du règlement ───
    let pluUrl = null, pluName = null;

    // SOURCE 1 : GPU Géoportail API — recherche par codgeo
    // Retourne le document avec son hash, depuis lequel on construit l'URL
    try {
      const gpuR = await fetch(
        `https://www.geoportail-urbanisme.gouv.fr/api/document?codgeo=${citycode}&_limit=5&etat=APPROUVE`,
        { headers: { ...H, 'Accept': 'application/json' } }
      );
      if (gpuR.ok) {
        const gpuD = await gpuR.json();
        console.log('GPU API response:', JSON.stringify(gpuD).slice(0, 300));
        
        // Cherche le document PLU/PLUi le plus récent
        const docs = gpuD.results || gpuD.data || (Array.isArray(gpuD) ? gpuD : []);
        const doc = docs.find(d => ['PLU','PLUi','CC'].includes(d.typeDocument)) || docs[0];
        
        if (doc?.id && doc?.partition) {
          const m = doc.partition.match(/^(\d+)_[^_]+_(\d{8})$/);
          if (m) {
            const [, codgeo, date] = m;
            const url = `https://data.geopf.fr/annexes/gpu/documents/DU_${codgeo}/${doc.id}/${codgeo}_reglement_${date}.pdf`;
            pluUrl = url;
            pluName = `${doc.typeDocument} ${city}` + fmtDate(url);
            console.log('✓ GPU API:', pluUrl);
          }
        }
      }
    } catch(e) { console.log('GPU API err:', e.message); }

    // SOURCE 2 : Chercher le règlement via DuckDuckGo
    // Recherche directe sur data.geopf.fr pour la commune
    if (!pluUrl) {
      try {
        const query = `${city} PLU règlement écrit PDF site:data.geopf.fr reglement`;
        const ddgR = await fetch(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
          { 
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html'
            } 
          }
        );
        if (ddgR.ok) {
          const html = await ddgR.text();
          // Cherche les URLs data.geopf.fr/annexes/gpu/documents contenant "reglement"
          const matches = html.match(/https:\/\/data\.geopf\.fr\/annexes\/gpu\/documents\/[^"'\s<>]+reglement[^"'\s<>]*\.pdf/gi) || [];
          // Prend l'URL la plus récente (date la plus haute dans le nom)
          const sorted = matches.sort((a, b) => {
            const da = a.match(/_(\d{8})\.pdf$/)?.[1] || '0';
            const db = b.match(/_(\d{8})\.pdf$/)?.[1] || '0';
            return db.localeCompare(da);
          });
          if (sorted[0]) {
            pluUrl = sorted[0];
            pluName = `PLU ${city}` + fmtDate(pluUrl);
            console.log('✓ DuckDuckGo search:', pluUrl);
          }
        }
      } catch(e) { console.log('DDG search err:', e.message); }
    }

    // SOURCE 3 : Base de données minimale (backup)
    if (!pluUrl) {
      const BNS = 'https://data.geopf.fr/annexes/gpu/documents/DU_200057990/35b89739df91562887f9e4623801ace5/200057990_reglement_20260217.pdf';
      const GPSO = 'https://data.geopf.fr/annexes/gpu/documents/DU_200057974/da0d24dad863b8b32a2323bc49cd389e/200057974_reglement_20251202.pdf';
      const DB = {
        '75056': ['https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf', 'PLU Paris — 16-19/12/2025'],
        '92012':[GPSO,'PLUi GPSO'],'92022':[GPSO,'PLUi GPSO'],'92040':[GPSO,'PLUi GPSO'],
        '92046':[GPSO,'PLUi GPSO'],'92049':[GPSO,'PLUi GPSO'],'92072':[GPSO,'PLUi GPSO'],
        '92073':[GPSO,'PLUi GPSO'],'92079':[GPSO,'PLUi GPSO'],
        '92004':[BNS,'PLUi BNS'],'92009':[BNS,'PLUi BNS'],'92024':[BNS,'PLUi BNS'],
        '92025':[BNS,'PLUi BNS'],'92036':[BNS,'PLUi BNS'],'92078':[BNS,'PLUi BNS'],
        '95018':[BNS,'PLUi BNS'],
        '92051':['https://data.geopf.fr/annexes/gpu/documents/DU_92051/e6c8855ff88ca1b7823c688132f2d6f1/92051_reglement_20210629.pdf','PLU Neuilly-sur-Seine'],
        '92075':['https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf','PLU Suresnes'],
        '94037':['https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf','PLU Gentilly'],
      };
      const partCodgeo = partition?.match(/^(\d+)_/)?.[1];
      const entry = DB[citycode] || (partCodgeo && DB[partCodgeo]);
      if (entry) { [pluUrl, pluName] = entry; }
    }

    console.log('FINAL:', { citycode, zone, partition, city, found: !!pluUrl });
    return res.status(200).json({
      success: true, address: label,
      coordinates: { lat, lon },
      citycode, zone, partition,
      pluUrl, pluName
    });

  } catch(err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: err.message });
  }
}
