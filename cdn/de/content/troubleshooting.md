# CloudCDN — Fehlerbehebung

## Asset wird nicht geladen (404)

### Symptom
`https://cloudcdn.pro/projekt/image.webp` gibt 404 zurück.

### Häufige Ursachen
1. **Datei wurde noch nicht gepusht.** Prüfen Sie `git status` — ist die Datei committet und gepusht?
2. **Deployment läuft noch.** Das GitHub-Actions-Deployment dauert 30 bis 90 Sekunden. Prüfen Sie den Actions-Tab.
3. **Falscher Pfad.** URLs sind case-sensitive. `Logo.webp` ist nicht dasselbe wie `logo.webp`.
4. **WebP/AVIF noch nicht erzeugt.** Die Auto-Konvertierung läuft beim Push. Wenn Sie ein PNG gepusht haben, erscheinen die `.webp`- und `.avif`-Varianten, sobald die compress-images-Action abgeschlossen ist.
5. **Datei über 25 MB.** Dateien über 25 MB werden von der CDN-Auslieferung ausgeschlossen. Prüfen Sie die Dateigröße mit `ls -lh`.

### Lösung
```bash
# Existenz der Datei im Repo prüfen
git ls-files | grep ihre-datei

# Status der Actions prüfen
gh run list --limit 5

# URL direkt testen
curl -sI https://cloudcdn.pro/projekt/images/logo.webp
```

## Commit-Signierung schlägt fehl

### Symptom
```
error: Signing failed: agent refused operation
```

### Häufige Ursachen
1. **SSH-Agent läuft nicht.** Starten Sie ihn:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Hardware-Schlüssel nicht berührt.** Bei Verwendung einer YubiKey oder eines Sicherheitsschlüssels (Ed25519-SK) tippen Sie den Schlüssel an, wenn Sie dazu aufgefordert werden.
3. **Falscher Signierschlüssel konfiguriert.** Überprüfen Sie:
   ```bash
   git config --global user.signingkey
   ```
4. **SSH-Schlüssel nicht zu GitHub hinzugefügt.** Gehen Sie zu GitHub → Settings → SSH and GPG keys. Stellen Sie sicher, dass Ihr Schlüssel als **Signing Key** (nicht nur zur Authentifizierung) gelistet ist.

## WebP/AVIF wird nicht erzeugt

### Symptom
Sie haben ein PNG gepusht, aber es ist keine `.webp`- oder `.avif`-Variante erschienen.

### Häufige Ursachen
1. **Compress-Action wurde nicht ausgelöst.** Der Workflow wird nur bei neuen PNG/JPEG-Dateien ausgelöst. Wenn die Datei bereits existierte, wird sie nicht erneut verarbeitet. Prüfen Sie den Actions-Tab.
2. **Datei wurde nicht als neu erkannt.** Der Workflow nutzt `git diff HEAD~1`, um neue Dateien zu finden. Wenn Sie einen Commit geändert haben (amend), erkennt das Diff sie möglicherweise nicht.
3. **Sharp-Konvertierung fehlgeschlagen.** Einige fehlerhafte PNGs oder ungewöhnliche Farbprofile können Konvertierungsfehler verursachen. Prüfen Sie die Action-Logs.

### Lösung
Führen Sie das Konvertierungsskript lokal aus:
```bash
cd scripts && npm install
node convert.mjs ../../ihr-projekt
```

## Veraltete Inhalte nach dem Push

### Symptom
Sie haben ein aktualisiertes Bild gepusht, aber die alte Version wird weiterhin ausgeliefert.

### Ursache
Assets werden mit `immutable`-Headern für 1 Jahr gecacht. Das Aktualisieren einer Datei unter derselben URL invalidiert die Caches nicht.

### Lösung
**Ändern Sie den Dateinamen oder Pfad.** Das ist beabsichtigt — unveränderliches Caching ist die schnellste Auslieferungsstrategie.
```bash
# Statt logo.png zu aktualisieren, verwenden Sie versionierte Namen:
logo-v2.png
# Oder datumbasiert:
logo-2026-03.png
```

Pro/Enterprise-Kunden können bestimmte URLs über das Cloudflare-Dashboard purgen.

## Deployment schlägt fehl (GitHub Actions)

### Symptom
Die Action „Deploy to Cloudflare Pages" schlägt fehl.

### Häufige Ursachen
1. **Ungültiges API-Token.** Das Token ist möglicherweise abgelaufen oder rotiert worden. Aktualisieren Sie `CLOUDFLARE_API_TOKEN` in den GitHub Secrets.
2. **Fehlende Berechtigungen.** Das Token benötigt: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **Datei über 25 MB.** Der Deploy-Workflow entfernt automatisch Dateien über 25 MB, prüfen Sie aber die Logs auf Fehler.
4. **Cloudflare-Service-Problem.** Prüfen Sie cloudflarestatus.com.

### Lösung
```bash
# Den fehlgeschlagenen Workflow erneut ausführen
gh run rerun <run-id>

# Logs prüfen
gh run view <run-id> --log-failed
```

## Manifest wird nicht aktualisiert

### Symptom
Neue Assets erscheinen weder in `manifest.json` noch im Dashboard.

### Ursache
Der Manifest-Generator wird bei Änderungen an Bildpfaden ausgelöst. Wenn Sie Dateien außerhalb der erwarteten Pfade gepusht haben, wird er möglicherweise nicht ausgelöst.

### Lösung
Manuell auslösen:
```bash
gh workflow run generate-manifest
```
Oder lokal regenerieren:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Bandbreitenlimit erreicht (kostenloser Tarif)

### Symptom
Assets liefern Fehler oder werden mitten im Monat nicht mehr geladen.

### Ursache
Der kostenlose Tarif hat 10 GB/Monat Bandbreite. Sie erhalten eine E-Mail bei 80 % Verbrauch.

### Lösung
- Optimieren Sie Bilder weiter (verwenden Sie AVIF-URLs anstelle von PNG für ca. 70 % Reduktion).
- Upgraden Sie auf Pro (29 $/Monat) für 100 GB/Monat.
- Warten Sie auf den nächsten Monat — die Limits werden am Ersten zurückgesetzt.

## Concierge-Chat antwortet nicht

### Symptom
Das KI-Chat-Widget auf der Startseite antwortet nicht oder zeigt Fehler an.

### Häufige Ursachen
1. **Monatliches Anfragenlimit erreicht (1.000/Monat).** Der Concierge deaktiviert sich selbst, wenn das Limit erreicht ist.
2. **Cloudflare Workers AI vorübergehend nicht verfügbar.** Selten, aber Edge-KI-Inferenz kann kurze Ausfälle haben.
3. **Wissensbasis nicht synchronisiert.** Wenn Inhaltsdateien kürzlich aktualisiert wurden, muss der Vectorize-Index möglicherweise neu synchronisiert werden.

### Lösung
Bei Synchronisationsproblemen der Wissensbasis:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
