# Tarifs CloudCDN (2026)

## Comparaison des offres

| Fonctionnalité | Gratuit | Pro (29 $/mois) | Enterprise (sur devis) |
|----------------|---------|-----------------|------------------------|
| Bande passante | 10 Go/mois | 100 Go/mois | Illimitée |
| Stockage | Fichiers illimités | Fichiers illimités | Stockage dédié |
| Formats d'image | Conversion auto WebP + AVIF | WebP + AVIF + contrôles de qualité | Suite complète + lots |
| Transformations d'images | Aucune | Redimensionnement, recadrage, format via URL | API complète + traitement par lots |
| Domaines personnalisés | Non inclus | Jusqu'à 5 (SSL automatique) | Illimités |
| Analytics | Aucun | Tableau de bord basique | Temps réel par actif/région |
| Support | Communauté / GitHub Issues | E-mail prioritaire (SLA 24 h) | Responsable dédié + Slack |
| SLA | Au mieux (environ 99,9 %) | Garantie de disponibilité 99,9 % | 99,99 % + crédits financiers |
| Commits signés | Obligatoires | Obligatoires | Obligatoires |
| SSO/SAML | Non | Non | Oui |
| Journaux d'audit | Non | Non | Oui |

## Palier gratuit (open source)
- **Cible :** projets personnels, logiciels open source, passionnés.
- **Coût :** 0 $/mois — gratuit à vie, aucune carte bancaire requise.
- **Bande passante :** 10 Go/mois. Les actifs cessent d'être servis via le CDN en cas de dépassement (les fichiers restent dans Git).
- **Actifs :** fichiers statiques illimités (PNG, WebP, AVIF, SVG, ICO).
- **Auto-optimisation :** chaque PNG/JPEG poussé est automatiquement converti en WebP (qualité 80) et AVIF (qualité 65).
- **Diffusion :** TTFB inférieur à 100 ms depuis les plus de 300 PoP edge de Cloudflare. Mise en cache immuable (max-age d'un an).
- **Limites :** pas de domaines personnalisés, pas d'API de transformation d'images, pas de tableau de bord d'analytics.

## Palier Pro
- **Cible :** projets commerciaux, startups, sites à fort trafic.
- **Coût :** 29 $/mois (ou 278 $/an — économisez 20 %).
- **Bande passante :** 100 Go/mois inclus. Dépassement : 0,05 $/Go facturé en fin de cycle.
- **API de transformation d'images :** redimensionnement, recadrage et conversion à la volée via des paramètres d'URL :
  ```
  https://cloudcdn.pro/projet/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Négociation de format :** diffusion automatique AVIF/WebP selon l'en-tête `Accept` du navigateur.
- **Domaines personnalisés :** jusqu'à 5 domaines avec provisionnement SSL automatique.
- **Support prioritaire :** support par e-mail avec garantie de réponse sous 24 heures.
- **SLA :** disponibilité de 99,9 %. En cas de non-respect, crédit de service de 10 % par tranche de 0,1 % sous le seuil.
- **Analytics :** bande passante, nombre de requêtes, taux de hit de cache, distribution des formats.
- **Essai gratuit de 14 jours** avec accès complet. Aucune carte bancaire requise.

## Palier Enterprise
- **Cible :** plateformes mondiales, groupes médias, e-commerce à grande échelle.
- **Coût :** tarification personnalisée — contactez sales@cloudcdn.pro.
- **Bande passante :** illimitée avec allocation edge dédiée.
- **Suite API complète :** toutes les transformations Pro plus le traitement par lots, les notifications webhook et les téléversements programmatiques.
- **Domaines personnalisés :** illimités avec SSL wildcard.
- **Support dédié :** responsable de compte nommé, canal Slack privé, SLA de réponse d'une heure.
- **SLA :** disponibilité de 99,99 %. Crédits financiers : 25 % pour moins de 99,99 %, 50 % pour moins de 99,9 %, 100 % pour moins de 99,0 %.
- **Sécurité :** SSO/SAML, journaux d'audit avec rétention de 12 mois, listes d'autorisation IP.
- **Analytics :** tableau de bord en temps réel avec ventilations par actif, par région et par format.
- **Conformité :** DPA RGPD disponible, options de résidence des données (UE/États-Unis).

## Comment nous nous comparons

| Fournisseur | Palier gratuit | Entrée payante | API de transformation |
|-------------|----------------|----------------|------------------------|
| **CloudCDN** | 10 Go/mois | 29 $/mois (100 Go) | Oui (Pro et supérieur) |
| Cloudflare Images | 5 000 transformations/mois | Paiement à l'usage | Oui |
| ImageKit | 25 Go/mois | 9 $/mois | Oui |
| Cloudinary | Environ 5 000 transformations/mois | 89 $/mois | Oui (plus de 300 paramètres) |
| Bunny CDN | Essai de 14 jours | 9,50 $/mois forfaitaire | Limitée |
| Imgix | Aucun | 25 $/mois | Oui |

**Notre avantage :** aucune étape de build, workflow Git-natif, conversion automatique de format à la poussée, assistant de documentation propulsé par l'IA, et le réseau edge de plus de 300 PoP de Cloudflare — tout est inclus dès le palier gratuit.

## Facturation
- Facturation mensuelle par défaut. La facturation annuelle permet d'économiser 20 %.
- Palier gratuit : pas de carte bancaire, pas d'expiration d'essai.
- Essai Pro : 14 jours, accès complet aux fonctionnalités, sans carte bancaire.
- Dépassement : facturé en fin de cycle, jamais d'interruption de service en milieu de cycle.
- Annulez à tout moment. Aucun contrat à long terme. Les données restent accessibles pendant 30 jours après l'annulation.

## Politique d'usage équitable
CloudCDN est conçu pour servir des actifs statiques : images, icônes, polices et documents. Il n'est pas destiné à la diffusion vidéo en continu (fichiers de plus de 25 Mo), à la distribution de binaires d'applications ou à l'hébergement de fichiers. Les comptes dépassant l'usage équitable seront contactés pour discuter d'une offre appropriée. Nous ne suspendrons jamais un compte sans préavis.
