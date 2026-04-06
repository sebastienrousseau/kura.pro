# CloudCDN — Sicherheitsleitfaden

## Überblick
CloudCDN erzwingt signierte Commits bei allen Pushes auf den `main`-Branch. Dadurch wird sichergestellt, dass jede Asset-Änderung kryptografisch verifiziert und einem bestimmten Mitwirkenden zugeordnet werden kann.

## Warum signierte Commits?
- **Integrität:** Garantiert, dass Assets bei der Übertragung nicht manipuliert wurden.
- **Audit-Trail:** Jede Änderung ist mit einer verifizierten Identität verknüpft.
- **Lieferkettensicherheit:** Verhindert unbefugte Änderungen an CDN-Inhalten.
- **Compliance:** Erfüllt die Sicherheitsanforderungen von Unternehmen für die Asset-Provenienz.

## SSH-Schlüssel einrichten (empfohlen)

### Ed25519-Schlüssel erzeugen
```bash
ssh-keygen -t ed25519 -C "ihre@email.com" -f ~/.ssh/id_ed25519
```

Für Hardware-Sicherheitsschlüssel (YubiKey usw.):
```bash
ssh-keygen -t ed25519-sk -C "ihre@email.com"
```

### Git konfigurieren
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Schlüssel zu GitHub hinzufügen
1. Kopieren Sie Ihren öffentlichen Schlüssel: `cat ~/.ssh/id_ed25519.pub`
2. Gehen Sie zu GitHub → Settings → SSH and GPG keys → New SSH key
3. Wählen Sie **Signing Key** als Schlüsseltyp
4. Einfügen und speichern

### Verifizieren
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## GPG-Schlüssel einrichten (alternativ)

### GPG-Schlüssel erzeugen
```bash
gpg --full-generate-key
```
Wählen Sie RSA 4096-Bit, legen Sie ein Ablaufdatum fest und geben Sie Ihre E-Mail-Adresse ein.

### Git konfigurieren
```bash
gpg --list-secret-keys --keyid-format=long
# Schlüssel-ID kopieren (z. B. 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Schlüssel zu GitHub hinzufügen
```bash
gpg --armor --export 3AA5C34371567BD2
```
Kopieren Sie die Ausgabe und fügen Sie sie unter GitHub → Settings → SSH and GPG keys → New GPG key hinzu.

## Branch Protection
Der `main`-Branch ist mit folgenden Regeln geschützt:
- **Signierte Commits erforderlich:** Alle Commits müssen kryptografisch signiert sein.
- **Keine Force-Pushes:** Die Historie kann nicht umgeschrieben werden.
- **Keine Branch-Löschung:** Der `main`-Branch kann nicht gelöscht werden.

## Sicherheit von API-Token
Für CI/CD-Workflows werden API-Token als GitHub Secrets gespeichert:
- `CLOUDFLARE_API_TOKEN` — wird für das Deployment auf Cloudflare Pages verwendet.
- `CLOUDFLARE_ACCOUNT_ID` — Ihre Cloudflare-Konto-Kennung.

Committen Sie niemals API-Token, Geheimnisse oder Anmeldeinformationen in das Repository. Verwenden Sie GitHub Secrets für alle sensiblen Werte.

## Best Practices für Sicherheit
1. Verwenden Sie nach Möglichkeit Hardware-Sicherheitsschlüssel (Ed25519-SK).
2. Rotieren Sie API-Token vierteljährlich.
3. Überprüfen Sie das GitHub-Audit-Protokoll auf unerwartete Zugriffe.
4. Aktivieren Sie die Zwei-Faktor-Authentifizierung in Ihrem GitHub-Konto.
5. Verwenden Sie den Befehl `git log --show-signature`, um Commit-Signaturen zu verifizieren.
