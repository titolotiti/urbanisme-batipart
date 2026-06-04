export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse manquante' });

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
  };

  function fmtDate(url) {
    const m = url?.match(/_(\d{8})\.pdf$/i);
    if (!m) return '';
    const d = m[1];
    return ` — ${d.slice(6)}/${d.slice(4,6)}/${d.slice(0,4)}`;
  }

  async function headOk(url) {
    if (!url) return false;
    try {
      const r = await fetch(url, { method: 'HEAD', headers: H, redirect: 'follow' });
      return r.ok;
    } catch { return false; }
  }

  // Cherche le règlement écrit dans une liste de documents
  // APICarto peut retourner l'URL dans href, url, download, ou lien
  function pickReglement(docs) {
    const u = d => d.href || d.url || d.download || d.lien || '';
    return (
      docs.find(d => u(d).match(/reglement(?!.*graphique).*\.pdf$/i)) ||
      docs.find(d => u(d).match(/regl[^/]*\.pdf$/i) && !u(d).includes('graphique')) ||
      docs.find(d => d.libelle?.toLowerCase().match(/règlement.*(tome\s*1|écrit)/i) && u(d).endsWith('.pdf')) ||
      docs.find(d => d.libelle?.toLowerCase().includes('règlement') && u(d).endsWith('.pdf')) ||
      docs.find(d => u(d).endsWith('.pdf') && !u(d).match(/graphique|rapport|padd|oap/i))
    );
  }

  try {
    // ─── ÉTAPE 1 : Géocodage ───
    const geoR = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
    const geoD = await geoR.json();
    if (!geoD.features?.length) return res.status(404).json({ error: 'Adresse non trouvée' });

    const feat = geoD.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const label = feat.properties.label;
    let citycode = feat.properties.citycode;
    // Normalisation arrondissements
    if (citycode.startsWith('751')) citycode = '75056';
    if (citycode.startsWith('692')) citycode = '69123';
    if (citycode.startsWith('132')) citycode = '13055';

    // ─── ÉTAPE 2 : Zone PLU ───
    let zone = null, partition = null;
    try {
      const zR = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({type:'Point',coordinates:[lon,lat]}))}`,
        { headers: H }
      );
      const zD = await zR.json();
      if (zD.features?.length) {
        const p = zD.features[0].properties;
        zone = (p.libelle || p.libelong || p.typezone || '').trim().replace(/\s+/g,'');
        partition = p.partition || null;
      }
    } catch(e) { console.log('Zone err:', e.message); }

    // ─── ÉTAPE 3 : Trouver le règlement PLU ───
    let pluUrl = null, pluName = null;

    // ① APICarto /document — source officielle, se met à jour automatiquement
    //    La partition encode déjà la date la plus récente
    if (partition) {
      try {
        const dR = await fetch(
          `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`,
          { headers: H }
        );
        const dD = await dR.json();
        if (dD.features?.length) {
          // APICarto retourne l'URL dans properties.href (pas .url !)
          const docs = dD.features.map(f => f.properties);
          const reg = pickReglement(docs);
          if (reg) {
            const url = reg.href || reg.url || reg.download;
            if (url && await headOk(url)) {
              pluUrl = url;
              pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
              console.log('✓ Source: APICarto document API →', pluUrl);
            }
          }
        }
      } catch(e) { console.log('APICarto doc err:', e.message); }
    }

    // ② Géoportail GPU — autre endpoint officiel
    if (!pluUrl && partition) {
      try {
        const gpuR = await fetch(
          `https://www.geoportail-urbanisme.gouv.fr/api/document/by-id/${encodeURIComponent(partition)}`,
          { headers: { ...H, Accept: 'application/json' } }
        );
        if (gpuR.ok) {
          const gpuD = await gpuR.json();
          const files = gpuD?.fichiers || gpuD?.files || gpuD?.documents || gpuD?.pieces || [];
          const reg = pickReglement(files);
          const url = reg?.href || reg?.url;
          if (url && await headOk(url)) {
            pluUrl = url;
            pluName = (reg.libelle || 'Règlement PLU') + fmtDate(url);
            console.log('✓ Source: GPU Géoportail →', pluUrl);
          }
        }
      } catch(e) { console.log('GPU err:', e.message); }
    }

    // ③ Construction dynamique depuis partition → data.geopf.fr
    //    Format: {codgeo}_{PLU|PLUi}_{YYYYMMDD}
    if (!pluUrl && partition) {
      try {
        const m = partition.match(/^(\d+)_(?:PLU|PLUi|PLU-H|PLUI)_(\d{8})$/i);
        if (m) {
          const [, codgeo, date] = m;
          // Récupère le hash du document depuis le Géoportail
          const infoR = await fetch(
            `https://www.geoportail-urbanisme.gouv.fr/api/document/by-id/${encodeURIComponent(partition)}`,
            { headers: H }
          );
          if (infoR.ok) {
            const info = await infoR.json();
            const hash = info?.id || info?.documentId || info?.codePartition;
            if (hash) {
              const url = `https://data.geopf.fr/annexes/gpu/documents/DU_${codgeo}/${hash}/${codgeo}_reglement_${date}.pdf`;
              if (await headOk(url)) {
                pluUrl = url;
                pluName = 'Règlement PLU' + fmtDate(url);
                console.log('✓ Source: data.geopf.fr construit →', pluUrl);
              }
            }
          }
        }
      } catch(e) { console.log('geopf construct err:', e.message); }
    }

    // ④ Base de données minimale — seulement pour communes avec problème connu
    //    Avec vérification live que le lien fonctionne encore
    if (!pluUrl) {
      const DB = {
        '75056': 'https://data.geopf.fr/annexes/gpu/documents/DU_75056/29b89f23c2ea085d0ea7706d42254ce2/75056_reglement_20251219.pdf',
        // PLUi GPSO (Boulogne, Issy, Chaville, Meudon, Sèvres, Vanves, Ville-d'Avray, Marnes)
        '200057974': 'https://data.geopf.fr/annexes/gpu/documents/DU_200057974/da0d24dad863b8b32a2323bc49cd389e/200057974_reglement_20251202.pdf',
      };
      // Détecte si la commune fait partie d'un PLUi (via le code de partition)
      const partCodgeo = partition?.match(/^(\d+)_/)?.[1];
      const dbKey = DB[citycode] ? citycode : (DB[partCodgeo] ? partCodgeo : null);

      if (dbKey) {
        const url = DB[dbKey];
        if (await headOk(url)) {
          pluUrl = url;
          pluName = 'Règlement PLU' + fmtDate(url);
          console.log('✓ Source: DB locale vérifiée →', pluUrl);
        } else {
          console.log('✗ DB URL morte pour', dbKey, '— upload manuel requis');
        }
      }
    }

    console.log('Résultat final:', { citycode, zone, partition, pluUrl: pluUrl ? '✓' : '✗' });

    return res.status(200).json({
      success: true,
      address: label,
      coordinates: { lat, lon },
      citycode,
      zone,
      partition,
      pluUrl,
      pluName,
      source: pluUrl ? 'auto' : 'manual'
    });

  } catch(err) {
    console.error('Erreur globale:', err);
    return res.status(500).json({ error: err.message });
  }
}
