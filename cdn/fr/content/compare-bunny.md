# CloudCDN face à Bunny CDN

## En un coup d'œil

| Fonctionnalité | CloudCDN | Bunny CDN |
|----------------|----------|-----------|
| **Prix d'entrée** | 29 $/mois (Pro) | 9,50 $/mois forfaitaire |
| **Palier gratuit** | 10 Go/mois de bande passante | Essai de 14 jours uniquement |
| **Modèle de facturation** | Paliers de bande passante | Au Go (tarif volumétrique à partir de 0,01 $/Go) |
| **Workflow** | Git-natif (git push) | Tableau de bord / FTP / API |
| **Auto-optimisation** | WebP + AVIF + JXL à la poussée | Bunny Optimizer (module complémentaire) |
| **API de stockage** | Schéma JSON compatible Bunny.net | Native |
| **Fonctionnalités IA** | Recherche sémantique + concierge RAG + serveur MCP | Aucune |
| **Commits signés** | Obligatoires (intégrité de la chaîne d'approvisionnement) | Non applicable |
| **Points de présence edge** | Plus de 300 (Cloudflare) | 114 PoP |
| **TTFB** | Médiane inférieure à 50 ms (NA/EU) | Typiquement 40 à 80 ms |
| **Calcul edge** | Cloudflare Workers (runtime JS complet) | Bunny Script (limité) |
| **Perma-Cache** | En-têtes immuables d'un an | Fonctionnalité Perma-Cache |
| **JPEG XL** | Pris en charge | Non disponible dans Optimizer |
| **Provenance des actifs** | Cryptographique (commits Git signés) | Aucune |
| **Serveur MCP** | Intégré | Non disponible |

## Pourquoi CloudCDN utilise des API compatibles Bunny

L'API de stockage de CloudCDN renvoie un schéma JSON compatible Bunny.net (Guid, StorageZoneName, Path, ObjectName, etc.). Cela signifie que les outils de migration et les scripts conçus pour Bunny fonctionnent avec CloudCDN sans aucune modification.

## Quand choisir CloudCDN

- Vous voulez un **workflow Git-natif** (pas de FTP, pas de téléversement via tableau de bord)
- Vous avez besoin d'une **recherche propulsée par l'IA** et d'une **intégration aux agents** (MCP)
- Vous avez besoin d'une **provenance cryptographique** pour chaque actif
- Vous voulez la **génération automatique de JPEG XL** en plus du WebP et de l'AVIF
- Vous voulez un **palier gratuit permanent** (l'essai de Bunny expire)

## Quand choisir Bunny CDN

- Vous avez besoin du **tarif au Go le plus bas possible** (0,01 $/Go dans certaines régions)
- Vous avez besoin d'un **accès FTP/SFTP** à votre stockage
- Vous avez besoin de **Bunny Stream** pour l'hébergement vidéo
- Vous avez un très gros volume de bande passante (plus de 100 To/mois) et besoin de tarifs dégressifs
- Vous avez besoin d'une **protection DDoS** en module complémentaire avec des règles personnalisées

## Comparaison des coûts

Pour un site diffusant 50 Go/mois :

- **CloudCDN Pro** : 29 $/mois
- **Bunny CDN** : environ 2,50 $/mois (EU/US à 0,05 $/Go) + 0,50 $/mois de stockage

Pour 500 Go/mois :

- **CloudCDN Pro** : 29 $ + (400 Go × 0,05 $) = 49 $/mois
- **Bunny CDN** : environ 25 $/mois (EU/US) + stockage

Bunny gagne sur le coût brut de la bande passante. CloudCDN gagne sur le workflow, les fonctionnalités IA, la provenance et le palier gratuit.
