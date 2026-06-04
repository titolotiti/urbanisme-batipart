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

  function pickReglement(items) {
    if (!items?.length) return null;
    const u = d => d.href || d.url || d.fichier || d.chemin || d.nom || '';
    return (
      items.find(d => u(d).match(/reglement(?!.*graphique).*\.pdf$/i)) ||
      items.find(d => d.libelle?.toLowerCase().match(/règlement.*(tome\s*1|écrit)/i) && u(d).endsWith('.pdf')) ||
      items.find(d => d.libelle?.toLowerCase().includes('règlement') && u(d).endsWith('.pdf')) ||
      items.find(d => u(d).endsWith('.pdf') && !u(d).match(/graphique|rapport|padd|oap|procedure/i))
    );
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
        zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g,'');
      }
    } catch(e) { console.log('Zone err:', e.message); }

    // ─── 3. Document PLU ───
    // APICarto /api/gpu/document avec la géométrie retourne la VRAIE partition
    // au format {codgeo}_{PLU|PLUi}_{YYYYMMDD}
    let partition = null, docId = null;
    try {
      const dR = await fetch(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geomStr)}`,
        { headers: H }
      );
      const dD = await dR.json();
      if (dD.features?.length) {
        const props = dD.features[0].properties;
        partition = props.partition || null;
        docId = props.id || props.documentId || props.codeKey || null;
        console.log('Document API:', { partition, docId, props: JSON.stringify(props).slice(0, 200) });
      }
    } catch(e) { console.log('Document err:', e.message); }

    // ─── 4. URL du règlement ───
    let pluUrl = null, pluName = null;

    // SOURCE 1 : GPU /api/document/{id}/details → liste des fichiers
    if (docId) {
      try {
        const detR = await fetch(
          `https://www.geoportail-urbanisme.gouv.fr/api/document/${docId}/details`,
          { headers: H }
        );
        if (detR.ok) {
          const detD = await detR.json();
          console.log('Details response:', JSON.stringify(detD).slice(0, 300));
          const fichiers = detD.fichiers || detD.files || detD.pieces || detD.piecesEcrites || [];
          const arr = Array.isArray(fichiers) ? fichiers : Object.values(fichiers);
          const reg = pickReglement(arr);
          const url = reg ? (reg.href || reg.url || reg.chemin) : null;
          if (url) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ GPU details:', pluUrl);
          }
        }
      } catch(e) { console.log('GPU details err:', e.message); }
    }

    // SOURCE 2 : Construire URL depuis partition + hash via GPU search
    if (!pluUrl && partition) {
      try {
        const m = partition.match(/^(\d+)_(?:PLU|PLUi|CC)[^_]*_(\d{8})$/i);
        if (m) {
          const [, codgeo, date] = m;
          const sR = await fetch(
            `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${encodeURIComponent(partition)}&_limit=1`,
            { headers: H }
          );
          if (sR.ok) {
            const sD = await sR.json();
            console.log('GPU search:', JSON.stringify(sD).slice(0, 200));
            const doc = Array.isArray(sD) ? sD[0] : (sD.results?.[0] || sD.data?.[0] || sD);
            const hash = doc?.id || doc?.hashKey || doc?._id;
            if (hash) {
              const url = `https://data.geopf.fr/annexes/gpu/documents/DU_${codgeo}/${hash}/${codgeo}_reglement_${date}.pdf`;
              pluUrl = url;
              pluName = 'Règlement PLU' + fmtDate(url);
              console.log('✓ URL construite:', pluUrl);
            }
          }
        }
      } catch(e) { console.log('URL construct err:', e.message); }
    }

    // SOURCE 3 : Base minimale (communes connues)
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
      if (entry) { [pluUrl, pluName] = entry; console.log('✓ DB:', citycode); }
    }

    console.log('FINAL:', { citycode, zone, partition, docId, found: !!pluUrl });
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
