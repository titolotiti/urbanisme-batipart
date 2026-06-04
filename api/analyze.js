import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const BASE_PROMPT = `Tu es un expert en droit de l'urbanisme français.
Analyse les extraits du règlement PLU (zone {ZONE}) pour l'opération suivante : {OPERATION}

Réponds avec ces 3 sections structurées. Pour chaque affirmation que tu fais, cite immédiatement après le passage exact du règlement qui la justifie — le passage doit être suffisamment long pour être compris seul, sans contexte supplémentaire.

---

## ① Faisabilité

**Verdict :** ✅ Possible / ⚠️ Possible sous conditions / ❌ Interdit / ❓ Non précisé dans le règlement

Explication en 2-3 phrases claires.

> *Page XX — Article YY :*
> "Colle ici le passage complet du règlement qui justifie ce verdict. Le passage doit être intégral, suffisamment long pour qu'on comprenne la règle sans aller chercher ailleurs."

---

## ② Logements sociaux

**Obligation :** [Oui X% / Non / Non mentionné]

Explique la règle en une phrase.

> *Page XX — Article YY :*
> "Passage exact et complet du règlement sur les obligations de mixité sociale ou logements sociaux. Si rien n'est mentionné, indique : Aucune disposition relative aux logements sociaux n'a été trouvée dans les articles applicables à la zone {ZONE}."

---

## ③ Conditions et contraintes

Pour chaque condition identifiée, structure ainsi :

**[Nom de la condition]**
Explication courte de ce que ça implique concrètement.
> *Page XX — Article YY :*
> "Passage exact et suffisamment long du règlement qui définit cette condition. Ne pas tronquer — inclure la phrase complète et les phrases de contexte nécessaires à la compréhension."

Répète ce format pour chaque condition.

---

Règles absolues :
- Toujours citer le texte EXACT entre guillemets, jamais de paraphrase
- Les passages cités doivent être complets — pas de "..." au milieu sauf si vraiment trop long
- Indiquer systématiquement page et article
- Si une information n'est pas dans le règlement, le dire explicitement`;

const OPERATIONS = {
  destination: "Changement de destination — transformation de bureaux en logements (habitation) sur bâtiment existant",
  surelevation: "Surélévation d'un bâtiment existant — ajout d'étages (hauteur maximale autorisée, gabarit, prospects)",
  extension: "Extension d'un bâtiment existant — agrandissement (emprise au sol, reculs, implantation)"
};

const PROMPTS = {
  destination: BASE_PROMPT,
  surelevation: BASE_PROMPT,
  extension: BASE_PROMPT
};

// Extrait les articles pertinents depuis le texte brut du PLU
function extractZoneText(fullText, zone) {
  const lines = fullText.split('\n');
  const relevant = [];
  let inZone = false;
  let inGeneral = false;
  const zoneUpper = zone.toUpperCase();
  const baseZone = zone.replace(/[0-9]/g, '').toUpperCase(); // ex: UBc → UB

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineUpper = line.toUpperCase();

    // Dispositions générales → toujours inclure
    if (lineUpper.includes('DISPOSITION') && lineUpper.includes('GÉNÉRAL')) {
      inGeneral = true;
    }
    // Début d'une autre zone → arrêt des dispositions générales
    if (inGeneral && lineUpper.match(/^ZONE\s+[A-Z]/) && !lineUpper.includes(baseZone)) {
      inGeneral = false;
    }

    // Début de la zone concernée
    if (lineUpper.includes(`ZONE ${zoneUpper}`) || lineUpper.includes(`ARTICLE ${zoneUpper}`)) {
      inZone = true;
    }
    // Début d'une autre zone → fin
    if (inZone && lineUpper.match(/^ZONE\s+[A-Z]/) && !lineUpper.includes(zoneUpper) && !lineUpper.includes(baseZone)) {
      inZone = false;
    }

    if (inZone || inGeneral) {
      relevant.push(line);
    }
  }

  // Si extraction vide, retourner le texte complet tronqué
  const result = relevant.join('\n').trim();
  if (result.length < 500) {
    return fullText.slice(0, 80000); // ~20k tokens max
  }
  return result.slice(0, 80000);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zone, analysisType, pluUrl, pluBase64 } = req.body;
  if (!zone) return res.status(400).json({ error: 'Zone PLU manquante' });
  if (!analysisType) return res.status(400).json({ error: "Type d'analyse manquant" });
  if (!pluUrl && !pluBase64) return res.status(400).json({ error: 'Document PLU manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  try {
    // Récupérer le PDF en buffer
    let pdfBuffer;
    if (pluBase64) {
      pdfBuffer = Buffer.from(pluBase64, 'base64');
    } else {
      const pdfRes = await fetch(pluUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/pdf,*/*' }
      });
      if (!pdfRes.ok) throw new Error(`Impossible de télécharger le PLU (${pdfRes.status})`);
      pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    }

    // Extraire le texte côté serveur — aucune limite de pages !
    const pdfData = await pdfParse(pdfBuffer);
    const fullText = pdfData.text;
    console.log(`PDF: ${pdfData.numpages} pages, ${fullText.length} chars`);

    // Extraire uniquement les articles pertinents pour la zone
    const zoneText = extractZoneText(fullText, zone);
    console.log(`Zone text: ${zoneText.length} chars`);

    // Analyser avec Claude (texte seulement, pas de PDF)
    const client = new Anthropic({ apiKey });
    const operation = OPERATIONS[analysisType];
    const prompt = PROMPTS[analysisType]
      ?.replace('{ZONE}', zone)
      ?.replace('{OPERATION}', operation);
    if (!prompt) return res.status(400).json({ error: "Type d'analyse invalide" });

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Voici les extraits du règlement PLU (zone ${zone}) :\n\n${zoneText}\n\n---\n\n${prompt}`
      }]
    });

    return res.status(200).json({
      success: true, zone, analysisType,
      result: message.content[0].text
    });

  } catch (error) {
    console.error('Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}
