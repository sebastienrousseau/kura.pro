# À propos de CloudCDN

## Qu'est-ce que CloudCDN ?
CloudCDN est un réseau de diffusion de contenu statique Git-natif pour développeurs. Poussez vos images dans un dépôt GitHub et elles sont automatiquement optimisées et diffusées mondialement depuis le réseau edge de Cloudflare — plus de 300 centres de données, plus de 100 pays, une latence inférieure à 100 ms.

Contrairement aux CDN d'images traditionnels qui exigent des tableaux de bord, des API d'envoi ou des intégrations SDK, CloudCDN utilise le workflow que les développeurs connaissent déjà : `git push`.

## Comment ça fonctionne
1. **Pousser :** Ajoutez des images au dépôt GitHub et committez avec une clé signée.
2. **Optimiser :** GitHub Actions compresse automatiquement les images et génère des variantes WebP (qualité 80, ~60 % plus légères) et AVIF (qualité 65, ~70 % plus légères).
3. **Déployer :** Les fichiers modifiés sont téléversés sur Cloudflare Pages via un déploiement incrémental (déduplication par hash de contenu — seuls les fichiers nouveaux ou modifiés sont transférés).
4. **Diffuser :** Les actifs sont servis avec des en-têtes de cache immuables (`max-age=31536000`) depuis le point edge le plus proche parmi plus de 300.

## Pile technologique
- **Réseau edge :** Cloudflare Pages sur plus de 300 PoP mondiaux. 95 % de la population mondiale se trouve à moins de 50 ms d'un centre de données Cloudflare.
- **Formats d'image :** PNG (original sans perte), WebP (avec perte, qualité 80), AVIF (avec perte, qualité 65), SVG (transmis tel quel), ICO (transmis tel quel).
- **Négociation de format :** Le palier Pro sert le format optimal en fonction de l'en-tête `Accept` du navigateur (AVIF > WebP > original).
- **Mise en cache :** Cache immuable en périphérie et côté navigateur avec un max-age d'un an. Invalidation du cache via le changement de nom de fichier ou de chemin.
- **CI/CD :** GitHub Actions pour la compression (Sharp), la génération du manifeste et le déploiement sur Cloudflare Pages (Wrangler).
- **Sécurité :** Commits signés en SSH Ed25519 obligatoires. Protection de la branche `main`. Jetons API chiffrés via GitHub Secrets.
- **Concierge IA :** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG pour la recherche intelligente dans la documentation sur la page d'accueil.

## Performances
- **TTFB :** Médiane inférieure à 50 ms en Amérique du Nord et en Europe, inférieure à 100 ms dans le monde (lors d'un hit sur le cache edge Cloudflare).
- **Taux de hit du cache :** Supérieur à 95 % pour les actifs en production (cache immuable).
- **Vitesse de déploiement :** Téléversements incrémentaux — seuls les fichiers modifiés sont transférés. Déploiement typique : 5 à 30 secondes.
- **Compression :** WebP économise environ 60 % par rapport au PNG. AVIF économise environ 70 % par rapport au PNG. Les deux sont générés automatiquement.

## Organisation des actifs
```
project-name/
  images/
    banners/    — Graphismes au format large (1200x630 recommandé)
    icons/      — Multi-résolution (de 16x16 à 512x512, avec @2x/@3x)
    logos/      — Logos de marque et emblèmes
    github/     — Images d'aperçu social
    titles/     — Graphismes de titres et en-têtes
  README.md     — Description optionnelle du projet
```

## Indicateurs clés
- **Plus de 1 400 actifs optimisés** répartis sur 54 zones locataires.
- **Source unique par image** — les dérivées sont générées à la demande via `/api/transform`.
- **Plus de 300 PoP edge** dans plus de 100 pays.
- **TTFB mondial inférieur à 100 ms** en cas de hit sur le cache edge.
- **Aucune étape de build** — pas de `npm install`, pas de webpack, aucun framework requis.

## Qui utilise CloudCDN ?
CloudCDN diffuse des actifs pour :
- **Projets open-source :** logos, bannières, icônes et illustrations de documentation.
- **Outils pour développeurs :** branding de développeurs Rust, Python et IA (rustdev, pythondev, llamadev).
- **Plateformes fintech :** bibliothèques d'actifs pour la banque et l'informatique quantique.
- **Applications audio :** visualisations de formes d'onde et composants d'interface.
- **Générateurs de sites statiques :** Shokunin, Kaishi et d'autres frameworks SSG.

## Pourquoi pas [concurrent] ?

| vs Cloudinary | vs Imgix | vs Bunny CDN |
|---|---|---|
| Pas de système de crédits complexe | Pas de facturation à base de crédits | Prise en charge de l'AVIF incluse |
| Workflow Git-natif | Workflow Git-natif | Workflow Git-natif |
| Palier gratuit, sans carte bancaire | Palier gratuit disponible | Pas d'expiration d'essai |
| Concierge IA intégré | Documentation standard uniquement | Documentation standard uniquement |

## Open source
L'infrastructure du CDN est open-source sous licence MIT. Dépôt : github.com/sebastienrousseau/cloudcdn.pro.

## Contact
- **Support :** support@cloudcdn.pro
- **Ventes :** sales@cloudcdn.pro
- **GitHub :** github.com/sebastienrousseau/cloudcdn.pro
- **Statut :** cloudcdn.pro (la page d'accueil affiche l'état opérationnel)
