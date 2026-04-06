# CloudCDN — Foire aux questions

## Pour commencer

### Qu'est-ce que CloudCDN ?
CloudCDN est un CDN d'images Git-natif. Poussez vos images dans un dépôt GitHub et elles sont automatiquement optimisées (WebP + AVIF) et diffusées mondialement depuis les plus de 300 points de présence edge de Cloudflare avec une latence inférieure à 100 ms.

### En quoi CloudCDN se distingue-t-il de Cloudinary ou d'Imgix ?
CloudCDN utilise un workflow Git-natif — pas de téléversement via tableau de bord, pas de SDK, pas de système de crédits. Vous faites `git push` et vos actifs sont en ligne. Cloudinary utilise une facturation à base de crédits à partir de 89 $/mois pour ses offres payantes. Imgix utilise des packs de crédits à partir de 25 $/mois. Le palier Pro de CloudCDN est à 29 $/mois avec une facturation simple à la bande passante.

### CloudCDN est-il gratuit pour les projets open-source ?
Oui. Le palier gratuit est gratuit à vie avec 10 Go/mois de bande passante. Aucune carte bancaire, aucune expiration d'essai. Idéal pour les logos, bannières, icônes et actifs de documentation des projets OSS.

### Dois-je installer quelque chose ?
Non. Vous n'avez besoin que de Git (2.34+) et d'une clé SSH pour les commits signés. Pas de Node.js, pas de gestionnaire de paquets, pas d'outils de build. Le pipeline CI/CD gère toute l'optimisation d'images côté serveur.

## Formats de fichiers

### Quels formats de fichiers sont pris en charge ?
Téléversement : PNG, JPEG, SVG, ICO, WebP. Le pipeline génère automatiquement des variantes WebP et AVIF pour tous les téléversements PNG et JPEG. Les fichiers SVG et ICO sont servis tels quels.

### Quels réglages de qualité sont utilisés pour la conversion automatique ?
WebP : qualité 80 (quasi sans perte, environ 60 % plus léger que le PNG). AVIF : qualité 65 (haute efficacité, environ 70 % plus léger que le PNG). Ces réglages sont optimisés pour le meilleur équilibre entre qualité visuelle et taille de fichier.

### Puis-je remplacer les réglages de qualité ?
Sur le palier Pro, l'API de transformation d'images prend en charge une qualité personnalisée via des paramètres d'URL : `?q=90` pour une qualité supérieure, `?q=50` pour plus de compression. Le palier gratuit utilise les réglages par défaut.

### Qu'en est-il de JPEG XL ?
En 2026, JPEG XL est activable via un flag dans Chrome et Firefox, avec une prise en charge partielle dans Safari. Nous ajouterons la conversion automatique JPEG XL lorsque la compatibilité des navigateurs dépassera 80 %. Actuellement, AVIF offre une meilleure compression avec une compatibilité plus large (plus de 93 % des navigateurs).

### Quelle est la taille de fichier maximale ?
25 Mo par fichier pour la diffusion via le CDN. Les fichiers de plus de 25 Mo restent dans le dépôt Git mais sont exclus du déploiement edge. Pour référence, un PNG 4K de haute qualité fait typiquement 5 à 15 Mo.

## Performances

### À quelle vitesse les actifs sont-ils diffusés ?
TTFB médian inférieur à 50 ms en Amérique du Nord et en Europe, inférieur à 100 ms dans le monde. Les actifs sont servis avec des en-têtes de cache immuables (max-age d'un an), de sorte que les visites répétées sont servies directement depuis le cache du navigateur.

### Comment fonctionne la mise en cache ?
Tous les actifs sont servis avec `Cache-Control: public, max-age=31536000, immutable`. Les navigateurs et les edges du CDN mettent les fichiers en cache pendant un an. Pour mettre à jour un actif, changez son nom de fichier (par exemple, `logo-v2.webp`) — c'est l'approche standard pour invalider le cache.

### Quel est le taux de hit du cache ?
Les actifs en production ont généralement un taux de hit de cache supérieur à 95 %. Le fichier manifest.json est mis en cache pendant 5 minutes pour rester frais. Le tableau de bord n'est jamais mis en cache.

### Puis-je purger le cache manuellement ?
Palier gratuit : les purges de cache ont lieu automatiquement au déploiement. Pro/Enterprise : vous pouvez purger des URL spécifiques ou des motifs génériques via le tableau de bord ou l'API Cloudflare.

## API de transformation d'images (Pro et supérieur)

### Comment fonctionne l'API de transformation ?
Ajoutez des paramètres d'URL à n'importe quelle URL d'actif :
```
https://cloudcdn.pro/projet/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### Quels paramètres sont disponibles ?
- `w` — Largeur en pixels (par exemple, `?w=400`)
- `h` — Hauteur en pixels (par exemple, `?h=300`)
- `fit` — Mode de redimensionnement : `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Format de sortie : `auto` (optimal pour le navigateur), `webp`, `avif`, `png`, `jpeg`
- `q` — Qualité : 1-100 (valeur par défaut variable selon le format)
- `blur` — Flou gaussien : 1-250 (par exemple, `?blur=20` pour un espace réservé LQIP)
- `sharpen` — Renforcement de la netteté : 1-10
- `gravity` — Ancrage du recadrage : `center`, `north`, `south`, `east`, `west`, `face` (IA)

### CloudCDN prend-il en charge la négociation automatique de format ?
Oui (Pro et supérieur). Lorsque vous utilisez `?format=auto`, CloudCDN lit l'en-tête `Accept` du navigateur et sert AVIF (si pris en charge), puis WebP, puis le format d'origine. Cela garantit que chaque visiteur reçoit le fichier le plus léger possible.

## Installation et workflow

### Comment puis-je téléverser des actifs ?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
En une à deux minutes, votre actif est en ligne à `https://cloudcdn.pro/my-project/images/logos/my-logo.webp`.

### Puis-je utiliser un domaine personnalisé ?
Les paliers Pro et Enterprise prennent en charge les domaines personnalisés. Les domaines personnalisés bénéficient d'un provisionnement SSL automatique et d'une configuration CNAME via Cloudflare DNS. Contactez support@cloudcdn.pro pour la configuration.

### Cela fonctionne-t-il sur macOS, Linux et WSL2 ?
Oui. Toutes les plateformes avec Git et SSH. Consultez le guide d'installation pour des instructions spécifiques à chaque plateforme, y compris la génération de clé SSH et la configuration de signature Git.

## Sécurité

### Les commits signés sont-ils obligatoires ?
Oui. Toutes les poussées vers la branche `main` exigent des commits signés (SSH Ed25519 ou GPG). Cela garantit que chaque modification d'actif est vérifiée cryptographiquement. Consultez le guide de sécurité pour la configuration.

### Mes données sont-elles sécurisées ?
Les actifs sont servis en HTTPS avec TLS 1.3. Le dépôt d'origine est sur GitHub avec protection de branche. Cloudflare fournit la protection DDoS, le WAF et la mitigation des bots sur tous les plans.

## Facturation

### Comment fonctionne la facturation à la bande passante ?
Gratuit : 10 Go/mois. Pro : 100 Go/mois inclus, 0,05 $/Go de dépassement. Enterprise : illimité. La bande passante = total d'octets livrés depuis l'edge jusqu'aux utilisateurs finaux. Les récupérations d'origine et les transferts CI/CD ne sont pas comptés.

### Puis-je changer d'offre à tout moment ?
Oui. Les montées en gamme prennent effet immédiatement (au prorata). Les descentes en gamme prennent effet au cycle de facturation suivant. Annulez à tout moment — aucun contrat.

### Y a-t-il un essai gratuit pour Pro ?
Oui. 14 jours d'essai complet. Aucune carte bancaire requise. Passage automatique au palier gratuit si vous ne souscrivez pas.

### Que se passe-t-il si je dépasse la bande passante du palier gratuit ?
Les actifs cessent d'être servis par le CDN pour le reste du mois. Ils restent dans le dépôt Git et reprennent leur diffusion au début du mois suivant. Vous recevrez un e-mail d'avertissement à 80 % d'utilisation.

## Conformité

### CloudCDN est-il conforme au RGPD ?
Oui. CloudCDN utilise l'infrastructure de Cloudflare, qui traite les données conformément au RGPD. Nous proposons un accord de traitement des données (DPA) pour les clients Enterprise. Aucune donnée personnelle d'utilisateur n'est stockée — nous ne servons que des fichiers statiques.

### Où les données sont-elles stockées ?
Les fichiers d'actifs sont stockés dans le dépôt GitHub (États-Unis) et mis en cache aux plus de 300 points de présence edge mondiaux de Cloudflare. Les copies mises en cache expirent après un an ou lors d'un nouveau déploiement.
