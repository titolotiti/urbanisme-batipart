// api/zone.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse manquante' });

  try {
    // ÉTAPE 1 : Géocoder l'adresse
    const geoRes = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
    const geoData = await geoRes.json();
    if (!geoData.features?.length) return res.status(404).json({ error: 'Adresse non trouvée' });

    const feature = geoData.features[0];
    const [lon, lat] = feature.geometry.coordinates;
    const label = feature.properties.label;
    const citycode = feature.properties.citycode;
    const city = feature.properties.city;

    // ÉTAPE 2 : Zone PLU via APICarto
    let zone = null, partition = null;
    try {
      const zoneRes = await fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))}`);
      const zoneData = await zoneRes.json();
      if (zoneData.features?.length) {
        const props = zoneData.features[0].properties;
        zone = props.libelle || props.typezone || null;
        partition = props.partition || null;
      }
    } catch(e) { console.log('Zone error:', e.message); }

    // ÉTAPE 3 : Trouver l'URL du PLU
    let pluUrl = null, pluName = null;

    // 3a : Essai via APICarto documents
    if (partition) {
      try {
        const docRes = await fetch(`https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`);
        const docData = await docRes.json();
        if (docData.features?.length) {
          const docs = docData.features.map(f => f.properties);
          const reg = docs.find(d =>
            (d.libelle?.toLowerCase().includes('règlement') || d.libelle?.toLowerCase().includes('reglement') || d.nom?.toLowerCase().includes('reglement'))
            && d.url?.endsWith('.pdf')
          ) || docs.find(d => d.url?.endsWith('.pdf'));
          if (reg?.url) { pluUrl = reg.url; pluName = reg.libelle || reg.nom || 'Règlement PLU'; }
        }
      } catch(e) { console.log('Doc error:', e.message); }
    }

    // 3b : Base de données PLU par ville (communes principales)
    if (!pluUrl) {
      const PLU_DB = {
        '75056': { url: 'https://www.paris.fr/pages/r-glements-locaux-d-urbanisme-2442', name: 'PLU Paris', search: true },
        '69123': { url: 'https://www.lyon.fr/sites/lyonfr/files/content/documents/2022-01/reglement_plu.pdf', name: 'PLU Lyon' },
        '13055': { url: 'https://www.marseille.fr/sites/default/files/contenu/urbanisme/plu/plu-reglement.pdf', name: 'PLU Marseille' },
        '92020': { url: 'https://www.colombes.fr/app/uploads/2024/03/AR-2._Re__glement_modification_n.5_-_approb_07-12-2023-1.pdf', name: 'PLU Colombes' },
        '92075': { url: 'https://www.suresnes.fr/wp-content/uploads/2024/06/PLU-Reglement-ecrit-V2.pdf', name: 'PLU Suresnes' },
        '94037': { url: 'https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf', name: 'PLU Gentilly' },
        '92023': { url: 'https://www.clamart.fr/wp-content/uploads/2023/reglement-plu.pdf', name: 'PLU Clamart' },
        '92064': { url: 'https://www.puteaux.fr/sites/default/files/plu-reglement.pdf', name: 'PLU Puteaux' },
        '92062': { url: 'https://www.nanterre.fr/sites/default/files/plu_reglement.pdf', name: 'PLU Nanterre' },
      };

      if (PLU_DB[citycode]) {
        pluUrl = PLU_DB[citycode].url;
        pluName = PLU_DB[citycode].name;
      }
    }

    // 3c : Recherche sur Géoportail Urbanisme
    if (!pluUrl && partition) {
      try {
        const gpuUrl = `https://www.geoportail-urbanisme.gouv.fr/api/document/6/${encodeURIComponent(partition)}`;
        const gpuRes = await fetch(gpuUrl, { headers: { 'Accept': 'application/json' } });
        if (gpuRes.ok) {
          const gpuData = await gpuRes.json();
          const doc = gpuData?.find?.(d => d.libelleGroupDoc?.toLowerCase().includes('règlement'));
          if (doc?.urlDoc) { pluUrl = doc.urlDoc; pluName = doc.libelleGroupDoc; }
        }
      } catch(e) { console.log('GPU error:', e.message); }
    }

    return res.status(200).json({ success: true, address: label, coordinates: { lat, lon }, citycode, city, zone, partition, pluUrl, pluName });

  } catch (error) {
    console.error('Erreur zone:', error);
    return res.status(500).json({ error: error.message });
  }
}
