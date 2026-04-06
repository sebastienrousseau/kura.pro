# CloudCDN — Dépannage

## Actif introuvable (404)

### Symptôme
`https://cloudcdn.pro/projet/image.webp` renvoie une erreur 404.

### Causes fréquentes
1. **Fichier pas encore poussé.** Vérifiez `git status` — le fichier est-il committé et poussé ?
2. **Déploiement encore en cours.** Le déploiement GitHub Actions prend entre 30 et 90 secondes. Consultez l'onglet Actions.
3. **Chemin incorrect.** Les URL sont sensibles à la casse. `Logo.webp` n'est pas `logo.webp`.
4. **WebP/AVIF pas encore généré.** La conversion automatique s'exécute lors de la poussée. Si vous avez poussé un PNG, les variantes `.webp` et `.avif` apparaissent une fois l'action `compress-images` terminée.
5. **Fichier de plus de 25 Mo.** Les fichiers dépassant 25 Mo sont exclus de la diffusion CDN. Vérifiez la taille du fichier avec `ls -lh`.

### Solution
```bash
# Vérifier que le fichier existe dans le dépôt
git ls-files | grep votre-fichier

# Consulter l'état des Actions
gh run list --limit 5

# Tester l'URL directement
curl -sI https://cloudcdn.pro/projet/images/logo.webp
```

## Échec de la signature des commits

### Symptôme
```
error: Signing failed: agent refused operation
```

### Causes fréquentes
1. **L'agent SSH n'est pas en cours d'exécution.** Démarrez-le :
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Clé matérielle non touchée.** Si vous utilisez une YubiKey ou une clé de sécurité (Ed25519-SK), appuyez sur la clé lorsque cela est demandé.
3. **Mauvaise clé de signature configurée.** Vérifiez :
   ```bash
   git config --global user.signingkey
   ```
4. **Clé SSH non ajoutée à GitHub.** Allez sur GitHub → Settings → SSH and GPG keys. Assurez-vous que votre clé est répertoriée comme **Signing Key** (et pas uniquement en authentification).

## WebP/AVIF non généré

### Symptôme
Vous avez poussé un PNG mais aucune variante `.webp` ou `.avif` n'est apparue.

### Causes fréquentes
1. **L'action de compression ne s'est pas déclenchée.** Le workflow ne se déclenche que sur les nouveaux fichiers PNG/JPEG. Si le fichier existait déjà, il ne sera pas retraité. Consultez l'onglet Actions.
2. **Fichier non détecté comme nouveau.** Le workflow utilise `git diff HEAD~1` pour trouver les nouveaux fichiers. Si vous avez amendé un commit, le diff peut ne pas le détecter.
3. **Échec de conversion Sharp.** Certains PNG mal formés ou des profils de couleurs inhabituels peuvent provoquer des erreurs de conversion. Consultez les journaux de l'action.

### Solution
Exécutez le script de conversion localement :
```bash
cd scripts && npm install
node convert.mjs ../../votre-projet
```

## Contenu périmé après une poussée

### Symptôme
Vous avez poussé une image mise à jour mais l'ancienne version est toujours servie.

### Cause
Les actifs sont mis en cache avec des en-têtes `immutable` pendant un an. Mettre à jour un fichier à la même URL n'invalidera pas les caches.

### Solution
**Changez le nom de fichier ou le chemin.** C'est voulu par conception — la mise en cache immuable est la stratégie de diffusion la plus rapide.
```bash
# Au lieu de mettre à jour logo.png, utilisez des noms versionnés :
logo-v2.png
# Ou basés sur la date :
logo-2026-03.png
```

Les clients Pro/Enterprise peuvent purger des URL spécifiques via le tableau de bord Cloudflare.

## Échec du déploiement (GitHub Actions)

### Symptôme
L'action « Deploy to Cloudflare Pages » échoue.

### Causes fréquentes
1. **Jeton API invalide.** Le jeton a pu expirer ou être rotaté. Mettez à jour `CLOUDFLARE_API_TOKEN` dans les GitHub Secrets.
2. **Permissions manquantes.** Le jeton a besoin des permissions : Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **Fichier de plus de 25 Mo.** Le workflow de déploiement supprime automatiquement les fichiers de plus de 25 Mo, mais consultez les journaux en cas d'erreur.
4. **Problème de service Cloudflare.** Consultez cloudflarestatus.com.

### Solution
```bash
# Relancer le workflow en échec
gh run rerun <run-id>

# Consulter les journaux
gh run view <run-id> --log-failed
```

## Manifeste non mis à jour

### Symptôme
Les nouveaux actifs n'apparaissent pas dans `manifest.json` ou dans le tableau de bord.

### Cause
Le générateur de manifeste se déclenche sur les changements de chemins d'images. Si vous avez poussé des fichiers en dehors des chemins attendus, il peut ne pas se déclencher.

### Solution
Déclenchez-le manuellement :
```bash
gh workflow run generate-manifest
```
Ou régénérez localement :
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Limite de bande passante atteinte (palier gratuit)

### Symptôme
Les actifs renvoient des erreurs ou cessent de se charger en milieu de mois.

### Cause
Le palier gratuit dispose de 10 Go/mois de bande passante. Vous recevrez un e-mail à 80 % d'utilisation.

### Solution
- Optimisez davantage vos images (utilisez des URL AVIF au lieu de PNG pour une réduction d'environ 70 %).
- Passez à Pro (29 $/mois) pour 100 Go/mois.
- Attendez le mois suivant — les limites sont réinitialisées le premier du mois.

## Le chat du Concierge ne répond pas

### Symptôme
Le widget de chat IA sur la page d'accueil ne répond pas ou affiche des erreurs.

### Causes fréquentes
1. **Limite mensuelle de requêtes atteinte (1 000/mois).** Le Concierge se désactive lui-même lorsque la limite est atteinte.
2. **Cloudflare Workers AI temporairement indisponible.** Rare, mais l'inférence IA en périphérie peut connaître de brèves interruptions.
3. **Base de connaissances non synchronisée.** Si les fichiers de contenu ont été récemment mis à jour, l'index Vectorize peut nécessiter une resynchronisation.

### Solution
Pour les problèmes de synchronisation des connaissances :
```bash
CLOUDFLARE_API_TOKEN=<jeton> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
