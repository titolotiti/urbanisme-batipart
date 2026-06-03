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
    '92075': { url: 'https://www.suresnes.fr/wp-content/uploads/2024/07/4.1-Reglement-PLU-Suresnes-Modification-26-06-2024-V2.pdf', name: 'PLU Suresnes — Modif. 26/06/2024' },
    '92020': { url: 'https://www.colombes.fr/app/uploads/2024/03/AR-2._Re__glement_modification_n.5_-_approb_07-12-2023-1.pdf', name: 'PLU Colombes — Modif. 07/12/2023' },
    '94037': { url: 'https://www.ville-gentilly.fr/sites/default/files/modification_ndeg6_du_plu_-_reglement_ecrit.pdf', name: 'PLU Gentilly — Modif. 12/03/2024' },
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
    let citycode = feature.properties.citycode;
    const city = feature.properties.city;
    // Normalisation Paris/Lyon/Marseille : codes arrondissements → code commune
    if (citycode.startsWith('751')) citycode = '75056'; // Paris
    if (citycode.startsWith('692')) citycode = '69123'; // Lyon
    if (citycode.startsWith('132')) citycode = '13055'; // Marseille

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

    // 3a : APICarto documents EN PRIORITÉ (source officielle et à jour)
    if (partition) {
      try {
        const docRes = await fetch(
          `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`,
          { headers: HEADERS }
        );
        const docData = await docRes.json();
        if (docData.features?.length) {
          const docs = docData.features.map(f => f.properties);
          // Cherche le règlement écrit tome 1 en priorité
          const reg = 
            docs.find(d => d.url?.includes('reglement') && !d.url?.includes('graphique') && d.url?.endsWith('.pdf')) ||
            docs.find(d => (d.libelle?.toLowerCase().includes('règlement') || d.libelle?.toLowerCase().includes('reglement')) && d.url?.endsWith('.pdf')) ||
            docs.find(d => d.url?.endsWith('.pdf'));
          if (reg?.url) {
            pluUrl = reg.url;
            pluName = reg.libelle || reg.nom || 'Règlement PLU';
            // Ajouter la date si disponible dans l'URL
            const dateMatch = reg.url.match(/_(\d{8})\.pdf$/);
            if (dateMatch) {
              const d = dateMatch[1];
              pluName += ` (${d.slice(6)}-${d.slice(4,6)}-${d.slice(0,4)})`;
            }
          }
        }
      } catch(e) { console.log('APICarto doc error:', e.message); }
    }

    // 3b : Base de données locale (fallback si APICarto ne trouve pas)
    if (!pluUrl && PLU_DB[citycode]) {
      pluUrl = PLU_DB[citycode].url;
      pluName = PLU_DB[citycode].name;
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
