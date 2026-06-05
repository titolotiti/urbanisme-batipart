import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
GlobalWorkerOptions.workerSrc = join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');

// URLs des sections de zones pour les grands PLUi
// Utilisées uniquement si le règlement principal est trop volumineux
const ZONE_SECTIONS = {
  '200057867': 'https://plainecommune.fr/fileadmin/user_upload/Portail_Plaine_Commune/LA_DOC/PROJET_DE_TERRITOIRE/PLUI/PLUi_Exutoire/TOME_4-REGLEMENT_ECRIT_ET_GRAPHIQUE/TOME_4-REGLEMENT_ECRIT/4-1-2_Partie_2_Reglements_de_zones/4-1-2-1_Zones_UMD_UMT_UM_UC_UH_UA_UE_UG_UVP_N_A/200057867_4-1-2-1_Reglements_des_zones.pdf',
};

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse le règlement PLU (zone {ZONE}) pour l'opération : {OPERATION}

## ① Faisabilité
**Verdict :** ✅ Possible / ⚠️ Sous conditions / ❌ Interdit / ❓ Non précisé
Explication 2-3 phrases.
> *Page XX — Article YY :* "Passage exact."

## ② Logements sociaux
**Obligation :** [Oui X% / Non / Non mentionné]
> *Page XX — Article YY :* "Passage exact."

## ③ Conditions et contraintes
**[Condition]** — Ce que ça implique.
> *Page XX — Article YY :* "Passage exact."

Texte EXACT entre guillemets. Toujours indiquer page et article.`;

const OPERATIONS = {
  destination: "Changement de destination — bureaux → logements, bâtiment existant",
  surelevation: "Surélévation — ajout d'étages (hauteur max, gabarit, prospects)",
  extension: "Extension — agrandissement (emprise au sol, reculs, implantation)"
};

async function extractZone(source, zone) {
  const pdf = await getDocument(source).promise;
  const total = pdf.numPages;
  const zUp = zone.toUpperCase();
  const zBase = zone.replace(/\d+/g, '').toUpperCase();
  console.log(`pdfjs: ${total} pages, zone ${zone}`);

  let general = '', zoneText = '', inZone = false, found = false, tail = 0;
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const items = await page.getTextContent();
    const text = items.items.map(s => s.str).join(' ');
    const up = text.toUpperCase();

    if (i <= 20 && (up.includes('DISPOSITION') || up.includes('DÉFINITION')))
      general += `\n--- PAGE ${i} ---\n${text}`;

    if (!inZone && (up.includes(`ZONE ${zUp}`) || up.match(new RegExp(`\\bZONE\\s+${zUp}\\b`))))
      { inZone = true; found = true; console.log(`Zone ${zone} p.${i}`); }

    if (inZone) zoneText += `\n--- PAGE ${i} ---\n${text}`;

    if (inZone && zoneText.length > 1000) {
      const other = [...up.matchAll(/ZONE\s+([A-Z]+\d*)/g)].map(m => m[1])
        .find(z => z !== zUp && z !== zBase);
      if (other) { if (++tail >= 2) { console.log(`Fin zone p.${i}`); break; } }
      else tail = 0;
    }
    if (!found && i >= 200) break;
    if (found && i >= 150) break;
  }
  return found ? (general + zoneText).slice(0, 80000) : null;
}

async function sendToClaude(apiKey, content, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d.error));
  return d.content[0].text;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64, partition } = req.body;
  if (!zone || !analysisType || (!pluUrl && !pluBase64)) return res.status(400).json({ error: 'Paramètres manquants' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = BASE_PROMPT.replace('{ZONE}', zone).replace('{OPERATION}', OPERATIONS[analysisType] || analysisType);

  try {
    // ── Méthode principale : envoi PDF direct à Claude ──
    if (pluBase64 || pluUrl) {
      try {
        let pdfB64 = pluBase64;
        if (!pdfB64) {
          const r = await fetch(pluUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) throw new Error(`Téléchargement échoué (${r.status})`);
          pdfB64 = Buffer.from(await r.arrayBuffer()).toString('base64');
          console.log('PDF:', Math.round(pdfB64.length * 0.75 / 1024 / 1024), 'MB');
        }
        const result = await sendToClaude(apiKey, [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
          { type: 'text', text: prompt }
        ], prompt);
        console.log('✓ Méthode directe');
        return res.status(200).json({ success: true, zone, analysisType, result });
      } catch(e) {
        console.log('Méthode directe échouée:', e.message.slice(0, 100));
        // Continue vers le fallback
      }
    }

    // ── Fallback pdfjs : uniquement si méthode directe échoue ──
    // Cherche une URL de section de zone plus petite si disponible
    const territoryCode = pluUrl?.match(/DU_(\d+)\//)?.[1];
    const sectionUrl = territoryCode && ZONE_SECTIONS[territoryCode] ? ZONE_SECTIONS[territoryCode] : pluUrl;
    console.log('Fallback pdfjs:', sectionUrl);

    const source = pluBase64
      ? { data: new Uint8Array(Buffer.from(pluBase64, 'base64')), isEvalSupported: false }
      : { url: sectionUrl, httpHeaders: { 'User-Agent': 'Mozilla/5.0' }, rangeChunkSize: 65536, disableAutoFetch: true, isEvalSupported: false };

    const zoneText = await extractZone(source, zone);
    if (!zoneText) return res.status(400).json({ error: `Zone "${zone}" introuvable dans le document` });

    const result = await sendToClaude(apiKey, `Extraits règlement zone ${zone} :\n\n${zoneText}\n\n---\n\n${prompt}`, prompt);
    console.log('✓ Fallback pdfjs OK');
    return res.status(200).json({ success: true, zone, analysisType, result });

  } catch(err) {
    console.error('Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
