# CloudCDN — Performances

## Réseau edge
CloudCDN s'appuie sur le réseau mondial de Cloudflare :
- **Plus de 300 centres de données** dans plus de 100 pays et plus de 193 villes.
- **95 % de la population mondiale** se trouve à moins de 50 ms d'un PoP Cloudflare.
- **Plus de 8 000 interconnexions réseau** pour un routage optimal.
- Le routage anycast dirige automatiquement les requêtes vers le PoP le plus proche.

## Latence
| Région | TTFB médian (hit de cache) | TTFB P95 |
|--------|----------------------------|----------|
| Amérique du Nord | < 30 ms | < 80 ms |
| Europe | < 35 ms | < 90 ms |
| Asie-Pacifique | < 50 ms | < 120 ms |
| Amérique du Sud | < 60 ms | < 150 ms |
| Afrique | < 80 ms | < 200 ms |

Ce sont les temps pour un hit sur le cache edge. La première requête vers un PoP nécessite une récupération depuis l'origine (ajoute une seule fois entre 50 et 200 ms).

## Stratégie de mise en cache
Tous les actifs utilisent une mise en cache immuable agressive :
```
Cache-Control: public, max-age=31536000, immutable
```

Cela signifie :
- **Cache du navigateur :** 1 an. Aucune requête de revalidation.
- **Cache edge du CDN :** 1 an. Servi depuis le PoP le plus proche.
- **Taux de hit du cache :** supérieur à 95 % pour les actifs en production.
- **Invalidation du cache :** changez le nom de fichier ou le chemin pour servir des actifs mis à jour.

Le fichier manifest.json utilise une mise en cache de courte durée :
```
Cache-Control: public, max-age=300
```

## Compression d'images

### Comparaison des formats
| Format | Taille typique (vs PNG) | Prise en charge navigateur | Cas d'usage |
|--------|-------------------------|----------------------------|-------------|
| PNG | Référence (100 %) | 100 % | Sans perte, transparence |
| WebP | ~40 % du PNG | 97 % | Diffusion web générale |
| AVIF | ~30 % du PNG | 93 % | Compression maximale |
| SVG | Variable | 100 % | Graphismes vectoriels, icônes |

### Réglages de conversion automatique
- **WebP :** qualité 80, avec perte. Meilleur équilibre entre qualité et taille.
- **AVIF :** qualité 65, avec perte. Compression maximale avec une bonne fidélité visuelle.
- Les originaux (PNG/JPEG) sont toujours préservés en parallèle des variantes générées.

### Économies réelles
Pour un projet typique avec 50 icônes (de 16x16 à 512x512) :
- PNG total : environ 5 Mo
- WebP total : environ 2 Mo (réduction de 60 %)
- AVIF total : environ 1,5 Mo (réduction de 70 %)

Pour des images de bannière (1200x630) :
- PNG : environ 500 Ko en moyenne
- WebP : environ 150 Ko en moyenne
- AVIF : environ 90 Ko en moyenne

## Impact sur les Core Web Vitals
Diffuser des images optimisées via CloudCDN améliore directement :

### LCP (Largest Contentful Paint)
- Objectif : inférieur à 2,5 secondes.
- Impact : servir de l'AVIF au lieu du PNG peut réduire le LCP de 40 à 60 % pour les pages riches en images.
- Astuce : préchargez les images au-dessus de la ligne de flottaison avec `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Objectif : inférieur à 0,1.
- Impact : définissez toujours les attributs `width` et `height` sur les balises `<img>` pour réserver l'espace.
- Astuce : utilisez le champ `size` du manifest.json pour les calculs de mise en page responsive.

### INP (Interaction to Next Paint)
- Objectif : inférieur à 200 ms.
- Impact : des images plus petites signifient moins de travail de décodage sur le thread principal.
- Astuce : utilisez `loading="lazy"` sur les images sous la ligne de flottaison pour réduire le poids initial de la page.

## Performances de déploiement
| Mesure | Valeur |
|--------|--------|
| Déploiement incrémental (1 à 10 fichiers modifiés) | 5 à 15 secondes |
| Déploiement complet (plus de 10 000 fichiers) | 30 à 60 secondes |
| Compression d'image (par PNG, CI) | environ 200 ms |
| Génération du manifeste (plus de 10 000 actifs) | moins de 5 secondes |

Les déploiements utilisent la déduplication par hash de contenu — seuls les fichiers nouveaux ou modifiés sont téléversés. Après le déploiement initial, les poussées suivantes ne téléversent typiquement que les fichiers modifiés.

## Surveillance
- **Cloudflare Analytics :** disponible dans le tableau de bord Cloudflare → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions :** journaux de build et de déploiement disponibles dans l'onglet Actions.
- **Statut :** la page d'accueil (cloudcdn.pro) affiche l'état opérationnel.

## Conseils d'optimisation
1. **Utilisez les URL AVIF** lorsque c'est possible — elles sont 70 % plus légères que le PNG.
2. **Utilisez l'élément `<picture>`** pour le repli de format (AVIF → WebP → PNG).
3. **Préchargez les images critiques** au-dessus de la ligne de flottaison.
4. **Chargez en différé tout ce qui est sous la ligne de flottaison** avec `loading="lazy"`.
5. **Définissez des dimensions explicites** sur toutes les balises `<img>` pour éviter les décalages de mise en page.
6. **Utilisez la plus petite taille d'icône nécessaire** — ne servez pas du 512x512 quand du 64x64 suffit.
7. **Palier Pro :** utilisez `?format=auto` pour laisser CloudCDN servir automatiquement le format optimal.
