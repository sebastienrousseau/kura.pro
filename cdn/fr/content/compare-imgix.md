# CloudCDN face à Imgix

## En un coup d'œil

| Fonctionnalité | CloudCDN | Imgix |
|----------------|----------|-------|
| **Prix d'entrée** | 29 $/mois (Pro) | 25 $/mois (Basic) |
| **Palier gratuit** | 10 Go/mois de bande passante | Aucun |
| **Modèle de facturation** | Bande passante (Go) | Images d'origine + bande passante |
| **Workflow** | Git-natif (git push) | Tableau de bord / API / SDK |
| **Auto-optimisation** | WebP + AVIF + JXL à la poussée | À la volée uniquement |
| **Paramètres de transformation** | 9 (redimensionnement, format, flou, netteté, gravité, ajustement, qualité) | Plus de 400 |
| **Fonctionnalités IA** | Recherche sémantique + concierge RAG + serveur MCP | Détection de visage, recadrage automatique |
| **Commits signés** | Obligatoires (intégrité de la chaîne d'approvisionnement) | Non applicable |
| **Points de présence edge** | Plus de 300 (Cloudflare) | CDN Imgix (environ 50 PoP) |
| **TTFB** | Médiane inférieure à 50 ms (NA/EU) | Typiquement 60 à 100 ms |
| **JPEG XL** | Pris en charge (généré automatiquement à la poussée) | Pris en charge |
| **Provenance des actifs** | Cryptographique (commits Git signés) | Aucune |
| **Serveur MCP** | Intégré | Non disponible |

## Quand choisir CloudCDN

- Vous voulez un **palier gratuit** (Imgix n'en propose pas)
- Vous voulez un **workflow Git-natif** sans aucun SDK
- Vous avez besoin d'une **provenance cryptographique des actifs** pour la conformité
- Vous diffusez principalement des actifs de marque statiques et n'avez pas besoin de 400 paramètres de transformation
- Vous voulez l'**intégration aux agents IA** via MCP

## Quand choisir Imgix

- Vous avez besoin de **plus de 400 paramètres de transformation** pour des pipelines d'images complexes
- Vous avez besoin du **rendu en temps réel** de contenu téléversé par les utilisateurs
- Vous avez besoin de la **purge par motif d'URL** (à base d'expressions régulières)
- Vos images sont stockées sur S3/GCS et vous avez besoin d'un proxy de traitement

## Comparaison des coûts

Pour un site avec 500 images sources et 50 Go/mois de diffusion :

- **CloudCDN Pro** : 29 $/mois
- **Imgix Basic** : 25 $/mois + dépassement de bande passante

Pour plus de 1 000 images sources :

- **CloudCDN Pro** : 29 $/mois (images sources illimitées)
- **Imgix Growth** : 95 $/mois (1 500 images d'origine incluses)
