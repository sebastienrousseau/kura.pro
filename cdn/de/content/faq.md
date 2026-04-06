# CloudCDN — Häufig gestellte Fragen

## Erste Schritte

### Was ist CloudCDN?
CloudCDN ist ein Git-natives Bilder-CDN. Schieben Sie Bilder in ein GitHub-Repository, und sie werden automatisch optimiert (WebP + AVIF) und weltweit über Cloudflares über 300 Edge-Standorte mit einer Latenz unter 100 ms ausgeliefert.

### Wie unterscheidet sich CloudCDN von Cloudinary oder Imgix?
CloudCDN verwendet einen Git-nativen Workflow — keine Dashboard-Uploads, keine SDKs, keine Credit-Systeme. Sie machen `git push` und Ihre Assets sind live. Cloudinary verwendet eine credit-basierte Abrechnung ab 89 $/Monat für kostenpflichtige Tarife. Imgix verwendet Credit-Bundles ab 25 $/Monat. Der Pro-Tarif von CloudCDN kostet 29 $/Monat mit einfacher Bandbreitenabrechnung.

### Ist CloudCDN für Open-Source-Projekte kostenlos?
Ja. Der kostenlose Tarif ist dauerhaft kostenlos mit 10 GB/Monat Bandbreite. Keine Kreditkarte, keine Ablauffrist. Ideal für Logos, Banner, Icons und Dokumentations-Assets von OSS-Projekten.

### Muss ich etwas installieren?
Nein. Sie benötigen lediglich Git (2.34+) und einen SSH-Schlüssel für signierte Commits. Kein Node.js, keine Paketmanager, keine Build-Tools. Die CI/CD-Pipeline übernimmt die gesamte Bildoptimierung serverseitig.

## Dateiformate

### Welche Dateiformate werden unterstützt?
Upload: PNG, JPEG, SVG, ICO, WebP. Die Pipeline erzeugt automatisch WebP- und AVIF-Varianten für alle PNG- und JPEG-Uploads. SVG- und ICO-Dateien werden unverändert ausgeliefert.

### Welche Qualitätseinstellungen werden für die Auto-Konvertierung verwendet?
WebP: Qualität 80 (nahezu verlustfrei, ca. 60 % kleiner als PNG). AVIF: Qualität 65 (hohe Effizienz, ca. 70 % kleiner als PNG). Diese sind auf das beste Gleichgewicht zwischen Bildqualität und Dateigröße optimiert.

### Kann ich die Qualitätseinstellungen überschreiben?
Im Pro-Tarif unterstützt die Bildtransformations-API benutzerdefinierte Qualität über URL-Parameter: `?q=90` für höhere Qualität, `?q=50` für stärkere Komprimierung. Der kostenlose Tarif verwendet die Standardeinstellungen.

### Was ist mit JPEG XL?
Stand 2026 ist JPEG XL in Chrome und Firefox hinter einem Flag verborgen, mit teilweiser Safari-Unterstützung. Wir werden die JPEG-XL-Auto-Konvertierung hinzufügen, sobald die Browser-Unterstützung über 80 % liegt. Derzeit bietet AVIF eine bessere Komprimierung bei breiterer Kompatibilität (über 93 % Browser-Unterstützung).

### Wie groß darf eine Datei maximal sein?
25 MB pro Datei für die CDN-Auslieferung. Dateien über 25 MB verbleiben im Git-Repository, werden jedoch vom Edge-Deployment ausgeschlossen. Zur Orientierung: Ein hochwertiges 4K-PNG ist typischerweise 5 bis 15 MB groß.

## Performance

### Wie schnell ist die Asset-Auslieferung?
Median-TTFB unter 50 ms in Nordamerika und Europa, weltweit unter 100 ms. Assets werden mit unveränderlichen Cache-Headern (max-age von einem Jahr) ausgeliefert, sodass wiederholte Besuche direkt aus dem Browser-Cache bedient werden.

### Wie funktioniert das Caching?
Alle Assets werden mit `Cache-Control: public, max-age=31536000, immutable` ausgeliefert. Browser und CDN-Edges cachen Dateien ein Jahr lang. Um ein Asset zu aktualisieren, ändern Sie den Dateinamen (z. B. `logo-v2.webp`) — das ist der Standard-Ansatz für Cache-Busting.

### Wie hoch ist die Cache-Trefferquote?
Produktions-Assets erreichen typischerweise eine Cache-Trefferquote von über 95 %. Die manifest.json-Datei wird 5 Minuten lang gecacht, um aktuell zu bleiben. Das Dashboard wird niemals gecacht.

### Kann ich den Cache manuell purgen?
Kostenloser Tarif: Cache-Purges erfolgen automatisch beim Deployment. Pro/Enterprise: Sie können bestimmte URLs oder Wildcard-Muster über das Cloudflare-Dashboard oder die API purgen.

## Bildtransformations-API (Pro und höher)

### Wie funktioniert die Transformations-API?
Hängen Sie URL-Parameter an eine beliebige Asset-URL an:
```
https://cloudcdn.pro/projekt/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### Welche Parameter sind verfügbar?
- `w` — Breite in Pixel (z. B. `?w=400`)
- `h` — Höhe in Pixel (z. B. `?h=300`)
- `fit` — Resize-Modus: `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Ausgabeformat: `auto` (optimal für den Browser), `webp`, `avif`, `png`, `jpeg`
- `q` — Qualität: 1-100 (Standardwert variiert je nach Format)
- `blur` — Gaußscher Weichzeichner: 1-250 (z. B. `?blur=20` für einen LQIP-Platzhalter)
- `sharpen` — Schärfen: 1-10
- `gravity` — Crop-Anker: `center`, `north`, `south`, `east`, `west`, `face` (KI)

### Unterstützt CloudCDN automatische Format-Aushandlung?
Ja (Pro und höher). Wenn Sie `?format=auto` verwenden, liest CloudCDN den `Accept`-Header des Browsers und liefert AVIF (falls unterstützt), dann WebP, dann das Originalformat aus. So erhält jeder Besucher die kleinstmögliche Datei.

## Einrichtung und Workflow

### Wie lade ich Assets hoch?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
Innerhalb von 1 bis 2 Minuten ist Ihr Asset unter `https://cloudcdn.pro/my-project/images/logos/my-logo.webp` live.

### Kann ich eine eigene Domain verwenden?
Die Tarife Pro und Enterprise unterstützen eigene Domains. Eigene Domains erhalten ein automatisches SSL-Provisioning und die CNAME-Einrichtung über Cloudflare DNS. Wenden Sie sich für die Konfiguration an support@cloudcdn.pro.

### Funktioniert es auf macOS, Linux und WSL2?
Ja. Alle Plattformen mit Git und SSH. Im Setup-Guide finden Sie plattformspezifische Anweisungen einschließlich SSH-Schlüssel-Erzeugung und Git-Signaturkonfiguration.

## Sicherheit

### Sind signierte Commits Pflicht?
Ja. Alle Pushes auf den `main`-Branch erfordern signierte Commits (SSH Ed25519 oder GPG). Dies stellt sicher, dass jede Asset-Änderung kryptografisch verifiziert ist. Im Sicherheits-Guide finden Sie Anweisungen zur Einrichtung.

### Sind meine Daten sicher?
Assets werden über HTTPS mit TLS 1.3 ausgeliefert. Das Origin-Repository liegt auf GitHub mit Branch Protection. Cloudflare bietet DDoS-Schutz, WAF und Bot-Mitigation in allen Tarifen.

## Abrechnung

### Wie funktioniert die Bandbreitenabrechnung?
Kostenlos: 10 GB/Monat. Pro: 100 GB/Monat enthalten, 0,05 $/GB Mehrverbrauch. Enterprise: unbegrenzt. Bandbreite = vom Edge an Endbenutzer ausgelieferte Bytes. Origin-Pulls und CI/CD-Übertragungen werden nicht gezählt.

### Kann ich jederzeit upgraden oder downgraden?
Ja. Upgrades treten sofort in Kraft (anteilig berechnet). Downgrades treten zum nächsten Abrechnungszyklus in Kraft. Jederzeit kündbar — keine Verträge.

### Gibt es eine kostenlose Testphase für Pro?
Ja. 14 Tage Vollzugriff. Keine Kreditkarte erforderlich. Wechselt automatisch in den kostenlosen Tarif, wenn Sie kein Abonnement abschließen.

### Was passiert, wenn ich die Bandbreite des kostenlosen Tarifs überschreite?
Assets werden für den Rest des Monats nicht mehr über das CDN ausgeliefert. Sie verbleiben im Git-Repository und werden zu Beginn des nächsten Monats wieder ausgeliefert. Sie erhalten eine E-Mail-Warnung bei 80 % Verbrauch.

## Compliance

### Ist CloudCDN DSGVO-konform?
Ja. CloudCDN nutzt die Infrastruktur von Cloudflare, die Daten gemäß der DSGVO verarbeitet. Wir bieten einen Auftragsverarbeitungsvertrag (AVV) für Enterprise-Kunden. Es werden keine personenbezogenen Nutzerdaten gespeichert — wir liefern nur statische Dateien aus.

### Wo werden die Daten gespeichert?
Asset-Dateien werden im GitHub-Repository (USA) gespeichert und an Cloudflares über 300 globalen Edge-Standorten zwischengespeichert. Cache-Kopien laufen nach einem Jahr oder bei einem neuen Deployment ab.
