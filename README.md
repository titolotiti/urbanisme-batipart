# Analyseur PLU — Batipart

Outil d'analyse automatique des règlements PLU.

## Fonctionnalités

- 🔍 Détection automatique de la zone PLU depuis une adresse
- 📄 Téléchargement automatique du règlement PLU
- ⚖️ Changement de destination (Bureaux → Logements)
- 🏗️ Surélévation (hauteur max, gabarit)
- 📐 Extension (emprise au sol, reculs)

## Déploiement sur Vercel

### 1. Cloner ce repository sur votre machine ou l'importer directement dans Vercel

### 2. Configurer la variable d'environnement

Dans Vercel → Settings → Environment Variables :
- Nom : `ANTHROPIC_API_KEY`
- Valeur : votre clé API Anthropic (sk-ant-...)

### 3. Déployer

Vercel déploie automatiquement à chaque push sur main.

## Structure

```
├── public/
│   └── index.html      # Frontend
├── api/
│   ├── zone.js         # Détection zone PLU (APICarto IGN)
│   └── analyze.js      # Analyse Claude
├── package.json
└── vercel.json
```

## Technologies

- Frontend : HTML/CSS/JS vanilla
- Backend : Vercel Serverless Functions (Node.js)
- IA : Claude claude-opus-4-5 (Anthropic)
- Géolocalisation : API Adresse (data.gouv.fr)
- Zone PLU : APICarto IGN (apicarto.ign.fr)
