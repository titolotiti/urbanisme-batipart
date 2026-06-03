// api/zone.js
// Détecte automatiquement la zone PLU et télécharge le règlement
// depuis une adresse postale

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
    const geoRes = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`
    );
    const geoData = await geoRes.json();

    if (!geoData.features?.length) {
      return res.status(404).json({ error: 'Adresse non trouvée' });
    }

    const feature = geoData.features[0];
    const [lon, lat] = feature.geometry.coordinates;
    const label = feature.properties.label;
    const citycode = feature.properties.citycode;

    // ÉTAPE 2 : Trouver la zone PLU via APICarto
    const zoneRes = await fetch(
      `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))}`
    );
    const zoneData = await zoneRes.json();

    let zone = null;
    let partition = null;
    if (zoneData.features?.length) {
      const props = zoneData.features[0].properties;
      zone = props.libelle || props.typezone || null;
      partition = props.partition || null;
    }

    // ÉTAPE 3 : Trouver l'URL du règlement PLU via APICarto
    let pluUrl = null;
    let pluName = null;

    if (partition) {
      try {
        const docRes = await fetch(
          `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`
        );
        const docData = await docRes.json();

        if (docData.features?.length) {
          // Chercher le règlement écrit parmi les documents
          const docs = docData.features.map(f => f.properties);
          const reglement = docs.find(d =>
            d.libelle?.toLowerCase().includes('règlement') ||
            d.libelle?.toLowerCase().includes('reglement') ||
            d.nom?.toLowerCase().includes('reglement')
          ) || docs[0];

          if (reglement?.url) {
            pluUrl = reglement.url;
            pluName = reglement.libelle || reglement.nom || 'Règlement PLU';
          }
        }
      } catch (e) {
        console.log('Erreur recherche document PLU:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      address: label,
      coordinates: { lat, lon },
      citycode,
      zone,
      partition,
      pluUrl,
      pluName
    });

  } catch (error) {
    console.error('Erreur zone:', error);
    return res.status(500).json({ error: error.message });
  }
}
