# CloudCDN face à Cloudinary

## En un coup d'œil

| Fonctionnalité | CloudCDN | Cloudinary |
|----------------|----------|------------|
| **Prix d'entrée** | 29 $/mois (Pro) | 89 $/mois (Plus) |
| **Palier gratuit** | 10 Go/mois de bande passante | 25 crédits/mois (environ 5 000 transformations) |
| **Modèle de facturation** | Bande passante (Go) | À base de crédits (complexe) |
| **Workflow** | Git-natif (git push) | Téléversement via tableau de bord / SDK / API |
| **Auto-optimisation** | WebP + AVIF + JXL à la poussée | À la volée uniquement |
| **Fonctionnalités IA** | Recherche sémantique + concierge RAG | Suppression d'arrière-plan par IA, remplissage génératif |
| **Commits signés** | Obligatoires (intégrité de la chaîne d'approvisionnement) | Non applicable |
| **Points de présence edge** | Plus de 300 (Cloudflare) | Environ 60 PoP CDN |
| **TTFB** | Médiane inférieure à 50 ms (NA/EU) | Typiquement 80 à 120 ms |
| **Domaines personnalisés** | 5 (Pro), illimités (Enterprise) | Illimités (offres payantes) |
| **SLA** | 99,9 % (Pro), 99,99 % (Enterprise) | 99,9 % (Business et supérieur) |
| **SSO/SAML** | Enterprise | Enterprise |
| **Serveur MCP** | Intégré (intégration aux agents IA) | Non disponible |
| **Provenance des actifs** | Cryptographique (commits Git signés) | Horodatage de téléversement uniquement |

## Quand choisir CloudCDN

- Vous voulez un **workflow Git-natif** — pas de tableau de bord, pas de SDK, juste `git push`
- Vous avez besoin d'une **provenance cryptographique** pour chaque actif (conformité, piste d'audit)
- Vous voulez une **facturation simple à la bande passante** (aucun calcul de crédits)
- Vous diffusez des **actifs statiques** (logos, icônes, bannières, images) et souhaitez un TTFB inférieur à 50 ms
- Vous voulez une **recherche d'actifs propulsée par l'IA** et un **serveur MCP** pour des workflows pilotés par des agents

## Quand choisir Cloudinary

- Vous avez besoin d'**IA avancée pour les images** (suppression d'arrière-plan, remplissage génératif, recadrage automatique)
- Vous avez besoin de **transcodage vidéo** avec diffusion adaptative
- Vous avez besoin de **plus de 400 paramètres de transformation** pour des pipelines d'images complexes
- Vous avez déjà une intégration Cloudinary avec ses SDK

## Comparaison des coûts

Pour un site diffusant 50 Go/mois d'actifs statiques :

- **CloudCDN Pro** : 29 $/mois forfaitaire
- **Cloudinary Plus** : 89 $/mois + dépassement potentiel sur les crédits

Pour 200 Go/mois :

- **CloudCDN Pro** : 29 $ + (100 Go de dépassement × 0,05 $) = 34 $/mois
- **Cloudinary Advanced** : 224 $/mois
