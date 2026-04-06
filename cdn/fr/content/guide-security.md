# CloudCDN — Guide de sécurité

## Vue d'ensemble
CloudCDN impose des commits signés sur toutes les poussées vers la branche `main`. Cela garantit que chaque modification d'actif est vérifiée cryptographiquement et traçable jusqu'à un contributeur spécifique.

## Pourquoi des commits signés ?
- **Intégrité :** garantit que les actifs n'ont pas été falsifiés en transit.
- **Piste d'audit :** chaque modification est liée à une identité vérifiée.
- **Sécurité de la chaîne d'approvisionnement :** empêche les modifications non autorisées du contenu servi par le CDN.
- **Conformité :** répond aux exigences de sécurité des entreprises en matière de provenance des actifs.

## Configuration d'une clé SSH (recommandée)

### Générer une clé Ed25519
```bash
ssh-keygen -t ed25519 -C "vous@email.com" -f ~/.ssh/id_ed25519
```

Pour les clés matérielles de sécurité (YubiKey, etc.) :
```bash
ssh-keygen -t ed25519-sk -C "vous@email.com"
```

### Configurer Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Ajouter la clé à GitHub
1. Copiez votre clé publique : `cat ~/.ssh/id_ed25519.pub`
2. Allez sur GitHub → Settings → SSH and GPG keys → New SSH key
3. Sélectionnez **Signing Key** comme type de clé
4. Collez et enregistrez

### Vérifier
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## Configuration d'une clé GPG (alternative)

### Générer une clé GPG
```bash
gpg --full-generate-key
```
Sélectionnez RSA 4096 bits, définissez une date d'expiration et saisissez votre adresse e-mail.

### Configurer Git
```bash
gpg --list-secret-keys --keyid-format=long
# Copiez l'identifiant de clé (par exemple, 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Ajouter la clé à GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
Copiez la sortie et ajoutez-la à GitHub → Settings → SSH and GPG keys → New GPG key.

## Protection de branche
La branche `main` est protégée par les règles suivantes :
- **Commits signés obligatoires :** tous les commits doivent être signés cryptographiquement.
- **Pas de force push :** l'historique ne peut pas être réécrit.
- **Pas de suppression de branche :** la branche `main` ne peut pas être supprimée.

## Sécurité des jetons API
Pour les workflows CI/CD, les jetons API sont stockés comme GitHub Secrets :
- `CLOUDFLARE_API_TOKEN` — utilisé pour le déploiement sur Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — votre identifiant de compte Cloudflare.

Ne committez jamais de jetons API, de secrets ou d'identifiants dans le dépôt. Utilisez GitHub Secrets pour toutes les valeurs sensibles.

## Bonnes pratiques de sécurité
1. Utilisez des clés matérielles de sécurité (Ed25519-SK) lorsque c'est possible.
2. Renouvelez vos jetons API tous les trimestres.
3. Consultez le journal d'audit GitHub pour détecter tout accès inattendu.
4. Activez l'authentification à deux facteurs sur votre compte GitHub.
5. Utilisez la commande `git log --show-signature` pour vérifier les signatures de commits.
