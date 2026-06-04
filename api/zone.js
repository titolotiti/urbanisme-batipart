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
    const u = d => d.href || d.url || d.chemin || d.fichier || d.lien || d.nom || '';
    const isReg = d =>
      u(d).match(/reglement(?!.*graphique).*\.pdf$/i) ||
      (d.libelle?.toLowerCase().match(/règlement.*(tome\s*1|écrit)/i) && u(d).endsWith('.pdf')) ||
      (d.libelle?.toLowerCase().includes('règlement') && u(d).endsWith('.pdf'));
    const notGraph = d => !u(d).match(/graphique|rapport|padd|oap|procedure/i);
    return (
      items.find(d => isReg(d) && notGraph(d)) ||
      items.find(d => u(d).endsWith('.pdf') && notGraph(d))
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

    // ─── 2. Zone + partition via APICarto ───
    let zone = null, partition = null;
    try {
      const zR = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({ type:'Point', coordinates:[lon,lat] }))}`,
        { headers: H }
      );
      const zD = await zR.json();
      if (zD.features?.length) {
        const p = zD.features[0].properties;
        zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g,'');
        partition = p.partition || null;
      }
    } catch(e) { console.log('Zone err:', e.message); }

    // ─── 3. Règlement PLU ───
    let pluUrl = null, pluName = null;

    // ══ SOURCE 1 : GPU document/info ══
    // Endpoint officiel IGN — retourne tous les fichiers d'un document
    // Fonctionne pour TOUTES les communes, TOUJOURS à jour
    if (partition) {
      try {
        const iR = await fetch(
          `https://www.geoportail-urbanisme.gouv.fr/document/info/?partition=${encodeURIComponent(partition)}`,
          { headers: H }
        );
        if (iR.ok) {
          const iD = await iR.json();
          // La réponse contient une liste de fichiers dans .fichiers ou .files ou .piecesEcrites
          const files = iD.fichiers || iD.files || iD.piecesEcrites || iD.documents || iD.pieces || [];
          const arr = Array.isArray(files) ? files : Object.values(files);
          const reg = pickReglement(arr);
          const url = reg ? (reg.href || reg.url || reg.chemin) : null;
          if (url) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ GPU document/info:', pluUrl);
          }
        }
      } catch(e) { console.log('GPU info err:', e.message); }
    }

    // ══ SOURCE 2 : GPU download-by-partition ══
    // Si on n'a pas trouvé l'URL mais on a la partition,
    // on peut construire l'URL de téléchargement directement
    if (!pluUrl && partition) {
      try {
        const iR = await fetch(
          `https://www.geoportail-urbanisme.gouv.fr/document/info/?partition=${encodeURIComponent(partition)}`,
          { headers: H }
        );
        if (iR.ok) {
          const iD = await iR.json();
          // Cherche un fichier règlement dans tous les champs possibles
          const findFile = (obj) => {
            if (!obj) return null;
            if (typeof obj === 'string' && obj.match(/reglement.*\.pdf$/i)) return obj;
            if (typeof obj === 'object') {
              for (const v of Object.values(obj)) {
                const r = findFile(v);
                if (r) return r;
              }
            }
            return null;
          };
          const filename = findFile(iD);
          if (filename) {
            const url = `https://www.geoportail-urbanisme.gouv.fr/document/download-by-partition/${encodeURIComponent(partition)}/file/${encodeURIComponent(filename)}`;
            pluUrl = url;
            pluName = 'Règlement PLU' + fmtDate(filename);
            console.log('✓ GPU download-by-partition:', pluUrl);
          }
        }
      } catch(e) { console.log('GPU download-by-partition err:', e.message); }
    }

    // ══ SOURCE 3 : APICarto document API ══
    if (!pluUrl && partition) {
      try {
        const dR = await fetch(
          `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`,
          { headers: H }
        );
        const dD = await dR.json();
        if (dD.features?.length) {
          const docs = dD.features.map(f => f.properties);
          const reg = pickReglement(docs);
          const url = reg ? (reg.href || reg.url || reg.download) : null;
          if (url) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ APICarto doc:', pluUrl);
          }
        }
      } catch(e) { console.log('APICarto doc err:', e.message); }
    }

    // ══ SOURCE 4 : Base minimale sur data.geopf.fr ══
    if (!pluUrl) {
      const BNS = 'https://data.geopf.fr/annexes/gpu/documents/DU_200057990/35b89739df91562887f9e4623801ace5/200057990_reglement_20260217.pdf';
      const GPSO = 'https://data.geopf.fr/annexes/gpu/documents/DU_200057974/da0d24dad863b8b32a2323bc49cd389e/200057974_reglement_20251202.pdf';
      const DB = {
        '75056': ['https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf', 'PLU Paris — 16-19/12/2025'],
        '92012': [GPSO, 'PLUi GPSO — 02/12/2025'], '92022': [GPSO, 'PLUi GPSO — 02/12/2025'],
        '92040': [GPSO, 'PLUi GPSO — 02/12/2025'], '92046': [GPSO, 'PLUi GPSO — 02/12/2025'],
        '92049': [GPSO, 'PLUi GPSO — 02/12/2025'], '92072': [GPSO, 'PLUi GPSO — 02/12/2025'],
        '92073': [GPSO, 'PLUi GPSO — 02/12/2025'], '92079': [GPSO, 'PLUi GPSO — 02/12/2025'],
        '92004': [BNS, 'PLUi BNS — 17/02/2026'], '92009': [BNS, 'PLUi BNS — 17/02/2026'],
        '92024': [BNS, 'PLUi BNS — 17/02/2026'], '92025': [BNS, 'PLUi BNS — 17/02/2026'],
        '92036': [BNS, 'PLUi BNS — 17/02/2026'], '92078': [BNS, 'PLUi BNS — 17/02/2026'],
        '95018': [BNS, 'PLUi BNS — 17/02/2026'],
        '92051': ['https://data.geopf.fr/annexes/gpu/documents/DU_92051/e6c8855ff88ca1b7823c688132f2d6f1/92051_reglement_20210629.pdf', 'PLU Neuilly-sur-Seine — 29/06/2021'],
        '92075': ['https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf', 'PLU Suresnes — 26/06/2024'],
        '94037': ['https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf', 'PLU Gentilly — 12/03/2024'],
      };
      const partCodgeo = partition?.match(/^(\d+)_/)?.[1];
      const entry = DB[citycode] || (partCodgeo && DB[partCodgeo]);
      if (entry) { [pluUrl, pluName] = entry; console.log('✓ DB:', pluUrl); }
    }

    console.log('Result:', { citycode, zone, partition, found: !!pluUrl });
    return res.status(200).json({ success:true, address:label, coordinates:{lat,lon}, citycode, zone, partition, pluUrl, pluName });

  } catch(err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: err.message });
  }
}
