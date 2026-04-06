# CloudCDN — Compliance und Datenschutz

## Datenverarbeitung

### Welche Daten verarbeitet CloudCDN?
CloudCDN liefert statische Dateien aus (Bilder, Icons, Schriftarten). Es verarbeitet, speichert oder überträgt keine personenbezogenen Nutzerdaten. Der einzige Datenfluss ist:
1. Ein Browser fordert die URL einer statischen Datei an.
2. Cloudflares Edge liefert die zwischengespeicherte Datei aus.
3. Es werden Standard-HTTP-Logs erzeugt (IP, Zeitstempel, URL, User-Agent).

### Wo werden Daten gespeichert?
- **Quelldateien:** GitHub-Repository (gehostet in den USA durch GitHub/Microsoft).
- **Edge-Cache:** Cloudflares über 300 globale PoPs. Zwischengespeicherte Kopien werden weltweit für Performance verteilt.
- **Daten des KI-Concierge:** Konversationen werden nicht gespeichert. Das Chat-Widget verwendet ausschließlich In-Memory-Sitzungsstatus — keine serverseitige Protokollierung von Nutzeranfragen.
- **Rate-Limiting-Zähler:** Gespeichert in Cloudflare Workers KV (nur aggregierte Zählwerte, keine personenbezogenen Daten).

## DSGVO-Konformität

### Status
CloudCDN ist DSGVO-konform. Wir nutzen Cloudflare als Infrastrukturanbieter, der seine DSGVO-Konformität durch Folgendes aufrechterhält:
- Zertifizierung im EU-US Data Privacy Framework.
- Standardvertragsklauseln (SCCs) für internationale Datenübermittlungen.
- Verfügbarkeit von Auftragsverarbeitungsverträgen auf Anfrage.

### Datenminimierung
- Es werden keine Cookies von CloudCDN gesetzt.
- Kein Nutzer-Tracking, keine Analyse-Pixel.
- Es werden keine personenbezogenen Daten erhoben, gespeichert oder verarbeitet.
- HTTP-Zugriffsprotokolle werden von Cloudflare gemäß deren Datenschutzrichtlinie behandelt.

### Rechte betroffener Personen
Da CloudCDN keine personenbezogenen Daten erhebt, gibt es keine personenbezogenen Daten, auf die zugegriffen, die korrigiert oder gelöscht werden könnten. Wenn Sie der Meinung sind, dass Ihre personenbezogenen Daten versehentlich in einem Asset enthalten sind (z. B. ein Foto), wenden Sie sich für die Entfernung an support@cloudcdn.pro.

### AVV (Auftragsverarbeitungsvertrag)
Enterprise-Kunden können einen formellen AVV anfordern. Wenden Sie sich an sales@cloudcdn.pro.

## CCPA / CPRA (Kalifornien)
CloudCDN verkauft, teilt oder verwendet keine personenbezogenen Daten für gezielte Werbung. Es ist kein Opt-out-Mechanismus erforderlich, da keine personenbezogenen Daten erhoben werden.

## SOC 2 / ISO 27001
CloudCDN nutzt die Infrastruktur von Cloudflare, die Folgendes aufrechterhält:
- SOC 2 Type II-Zertifizierung.
- ISO 27001-Zertifizierung.
- PCI DSS Level 1-Konformität.
Diese Zertifizierungen umfassen die Edge-Auslieferungsinfrastruktur, die von CloudCDN verwendet wird.

## Sicherheitsmaßnahmen
- **Verschlüsselung bei der Übertragung:** TLS 1.3 auf allen Verbindungen.
- **DDoS-Schutz:** Automatische DDoS-Mitigation von Cloudflare in allen Tarifen.
- **WAF:** Cloudflare Web Application Firewall ist auf allen Endpoints aktiv.
- **Bot-Mitigation:** Cloudflare Bot Management schützt vor Scraping und Missbrauch.
- **Signierte Commits:** Alle Asset-Änderungen erfordern eine kryptografische Verifizierung.
- **Branch Protection:** Force-Pushes und das Umschreiben der Historie sind blockiert.
- **Secret-Management:** API-Token werden als verschlüsselte GitHub Secrets gespeichert, niemals im Code.

## Asset-Integrität
Jedes von CloudCDN ausgelieferte Asset ist auf einen signierten Git-Commit zurückführbar. Das bietet:
- **Provenienz:** Jede Dateiänderung ist mit einem verifizierten Mitwirkenden verknüpft.
- **Audit-Trail:** Vollständige Git-Historie mit Verifizierung signierter Commits.
- **Manipulationserkennung:** Jede unbefugte Änderung bricht die Signaturkette.

## Akzeptable Nutzung
CloudCDN ist ausschließlich für die Auslieferung statischer Assets vorgesehen. Verbotene Verwendungen umfassen:
- Hosting von Malware oder Phishing-Inhalten.
- Video-Streaming oder die Verteilung großer Dateien (über 25 MB).
- Speicherung personenbezogener Daten, Anmeldeinformationen oder sensibler Informationen in Assets.
- Nutzung des Dienstes zur Umgehung der Bedingungen anderer Dienste.

Verstöße führen zur Sperrung des Kontos mit einer Vorankündigung von 24 Stunden (außer bei illegalen Inhalten, die sofort entfernt werden).

## Vorfallreaktion
- Sicherheitsvorfälle werden gemäß den DSGVO-Anforderungen innerhalb von 72 Stunden gemeldet.
- Wenden Sie sich an security@cloudcdn.pro, um Schwachstellen zu melden.
- Enterprise-Kunden erhalten direkte Benachrichtigungen über ihren dedizierten Slack-Kanal.

## Kontakt
- **Datenschutzanfragen:** privacy@cloudcdn.pro
- **Sicherheitsmeldungen:** security@cloudcdn.pro
- **AVV-Anfragen:** sales@cloudcdn.pro
