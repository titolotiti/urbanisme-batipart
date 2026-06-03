export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse manquante' });

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/pdf,*/*',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  };

  // Base de données PLU par code INSEE — URLs vérifiées
  const PLU_DB = {
    '75056': { url: 'https://data.geopf.fr/annexes/gpu/documents/DU_75056/048baf0750b3de3650b7d0cf81c530ce/75056_reglement_20240722.pdf', name: 'PLU Paris bioclimatique (Règlement)' },
    '92075': { url: 'https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf', name: 'PLU Suresnes 2024' },
    '92020': { url: 'https://www.colombes.fr/app/uploads/2024/03/AR-2._Re__glement_modification_n.5_-_approb_07-12-2023-1.pdf', name: 'PLU Colombes 2023' },
    '94037': { url: 'https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf', name: 'PLU Gentilly 2024' },
    '92062': { url: 'https://www.nanterre.fr/fileadmin/user_upload/Documents/Urbanisme/PLU/Reglement/Reglement_ecrit.pdf', name: 'PLU Nanterre' },
    '92064': { url: 'https://www.puteaux.fr/sites/default/files/document/2023/plu-reglement-ecrit.pdf', name: 'PLU Puteaux' },
    '92023': { url: 'https://www.ville-clamart.fr/fileadmin/Clamart/Urbanisme/PLU/reglement.pdf', name: 'PLU Clamart' },
    '92012': { url: 'https://www.boulognebillancourt.com/sites/default/files/2023-01/plu_reglement.pdf', name: 'PLU Boulogne-Billancourt' },
    '92050': { url: 'https://www.levallois.fr/sites/default/files/plu_reglement.pdf', name: 'PLU Levallois-Perret' },
    '92040': { url: 'https://www.issy.com/sites/default/files/plu-reglement.pdf', name: 'PLU Issy-les-Moulineaux' },
    '92073': { url: 'https://www.saint-cloud.fr/sites/default/files/plu_reglement.pdf', name: 'PLU Saint-Cloud' },
    '93008': { url: 'https://www.bagnolet.fr/sites/default/files/plu-reglement.pdf', name: 'PLU Bagnolet' },
    '93029': { url: 'https://www.montreuil.fr/fileadmin/Urbanisme/PLU/Reglement.pdf', name: 'PLU Montreuil' },
    '94028': { url: 'https://www.fontenay-sous-bois.fr/sites/default/files/plu_reglement.pdf', name: 'PLU Fontenay-sous-Bois' },
    '94041': { url: 'https://www.ivry94.fr/sites/default/files/plu-reglement.pdf', name: 'PLU Ivry-sur-Seine' },
    '94043': { url: 'https://www.joinville-le-pont.fr/sites/default/files/plu_reglement.pdf', name: 'PLU Joinville-le-Pont' },
  };

  try {
    // ÉTAPE 1 : Géocoder l'adresse
    const geoRes = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`
    );
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
      const zoneRes = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))}`,
        { headers: HEADERS }
      );
      const zoneData = await zoneRes.json();
      if (zoneData.features?.length) {
        const props = zoneData.features[0].properties;
        zone = props.libelle || props.typezone || null;
        partition = props.partition || null;
      }
    } catch(e) { console.log('Zone error:', e.message); }

    // ÉTAPE 3 : Trouver URL du PLU
    let pluUrl = null, pluName = null;

    // 3a : Base de données locale
    if (PLU_DB[citycode]) {
      pluUrl = PLU_DB[citycode].url;
      pluName = PLU_DB[citycode].name;
    }

    // 3b : APICarto documents
    if (!pluUrl && partition) {
      try {
        const docRes = await fetch(
          `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`,
          { headers: HEADERS }
        );
        const docData = await docRes.json();
        if (docData.features?.length) {
          const docs = docData.features.map(f => f.properties);
          const reg = docs.find(d =>
            (d.libelle?.toLowerCase().includes('règlement') || d.nom?.toLowerCase().includes('reglement'))
            && d.url?.endsWith('.pdf')
          ) || docs.find(d => d.url?.endsWith('.pdf'));
          if (reg?.url) { pluUrl = reg.url; pluName = reg.libelle || reg.nom || 'Règlement PLU'; }
        }
      } catch(e) { console.log('APICarto doc error:', e.message); }
    }

    return res.status(200).json({
      success: true, address: label, coordinates: { lat, lon },
      citycode, city, zone, partition, pluUrl, pluName
    });

  } catch (error) {
    console.error('Erreur zone:', error);
    return res.status(500).json({ error: error.message });
  }
}
