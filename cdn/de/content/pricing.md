# CloudCDN-Preise (2026)

## Tarifvergleich

| Funktion | Kostenlos | Pro (29 $/Monat) | Enterprise (individuell) |
|----------|-----------|------------------|--------------------------|
| Bandbreite | 10 GB/Monat | 100 GB/Monat | Unbegrenzt |
| Speicher | Unbegrenzte Dateien | Unbegrenzte Dateien | Dedizierter Speicher |
| Bildformate | WebP + AVIF Auto-Konvertierung | WebP + AVIF + Qualitätssteuerung | Vollständige Suite + Batch |
| Bildtransformationen | Keine | Resize, Crop, Format per URL | Vollständige API + Batch-Verarbeitung |
| Eigene Domains | Nicht enthalten | Bis zu 5 (Auto-SSL) | Unbegrenzt |
| Analytics | Keine | Basis-Dashboard | Echtzeit pro Asset/Region |
| Support | Community / GitHub Issues | Priority-E-Mail (24-Stunden-SLA) | Dedizierter Manager + Slack |
| SLA | Best-Effort (~99,9 %) | 99,9 % Verfügbarkeitsgarantie | 99,99 % + finanzielle Gutschriften |
| Signierte Commits | Pflicht | Pflicht | Pflicht |
| SSO/SAML | Nein | Nein | Ja |
| Audit-Logs | Nein | Nein | Ja |

## Kostenloser Tarif (Open Source)
- **Zielgruppe:** persönliche Projekte, Open-Source-Software, Hobbyisten.
- **Kosten:** 0 $/Monat — für immer kostenlos, keine Kreditkarte erforderlich.
- **Bandbreite:** 10 GB/Monat. Assets werden bei Überschreitung nicht mehr über das CDN ausgeliefert (Dateien verbleiben in Git).
- **Assets:** unbegrenzte statische Dateien (PNG, WebP, AVIF, SVG, ICO).
- **Auto-Optimierung:** Jedes gepushte PNG/JPEG wird automatisch in WebP (Qualität 80) und AVIF (Qualität 65) konvertiert.
- **Auslieferung:** TTFB unter 100 ms von Cloudflares über 300 Edge-PoPs. Unveränderliches Caching (max-age von einem Jahr).
- **Einschränkungen:** keine eigenen Domains, keine Bildtransformations-API, kein Analytics-Dashboard.

## Pro-Tarif
- **Zielgruppe:** kommerzielle Projekte, Startups, Websites mit hohem Traffic.
- **Kosten:** 29 $/Monat (oder 278 $/Jahr — 20 % sparen).
- **Bandbreite:** 100 GB/Monat enthalten. Mehrverbrauch: 0,05 $/GB, am Zyklusende abgerechnet.
- **Bildtransformations-API:** Resize, Crop und Konvertierung on-the-fly über URL-Parameter:
  ```
  https://cloudcdn.pro/projekt/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Format-Aushandlung:** automatische AVIF/WebP-Auslieferung anhand des `Accept`-Headers des Browsers.
- **Eigene Domains:** bis zu 5 Domains mit automatischem SSL-Provisioning.
- **Priority-Support:** E-Mail-Support mit 24-Stunden-Antwortgarantie.
- **SLA:** 99,9 % Verfügbarkeit. Bei Verletzung 10 % Service-Gutschrift pro 0,1 % unter dem Schwellenwert.
- **Analytics:** Bandbreite, Anfragezahl, Cache-Trefferquote, Format-Verteilung.
- **14-tägige kostenlose Testphase** mit Vollzugriff. Keine Kreditkarte erforderlich.

## Enterprise-Tarif
- **Zielgruppe:** globale Plattformen, Medienunternehmen, E-Commerce in großem Maßstab.
- **Kosten:** individuelle Preise — wenden Sie sich an sales@cloudcdn.pro.
- **Bandbreite:** unbegrenzt mit dedizierter Edge-Zuteilung.
- **Vollständige API-Suite:** alle Pro-Transformationen plus Batch-Verarbeitung, Webhook-Benachrichtigungen und programmatische Uploads.
- **Eigene Domains:** unbegrenzt mit Wildcard-SSL.
- **Dedizierter Support:** namentlich genannter Account Manager, privater Slack-Kanal, 1-Stunden-Antwort-SLA.
- **SLA:** 99,99 % Verfügbarkeit. Finanzielle Gutschriften: 25 % bei unter 99,99 %, 50 % bei unter 99,9 %, 100 % bei unter 99,0 %.
- **Sicherheit:** SSO/SAML, Audit-Logs mit 12-monatiger Aufbewahrung, IP-Allowlisting.
- **Analytics:** Echtzeit-Dashboard mit Aufschlüsselungen pro Asset, Region und Format.
- **Compliance:** DSGVO-AVV verfügbar, Datenresidenz-Optionen (EU/USA).

## Vergleich

| Anbieter | Kostenloser Tarif | Einstiegspreis | Transform-API |
|----------|-------------------|----------------|---------------|
| **CloudCDN** | 10 GB/Monat | 29 $/Monat (100 GB) | Ja (Pro und höher) |
| Cloudflare Images | 5.000 Transformationen/Monat | Pay-as-you-go | Ja |
| ImageKit | 25 GB/Monat | 9 $/Monat | Ja |
| Cloudinary | ca. 5.000 Transformationen/Monat | 89 $/Monat | Ja (über 300 Parameter) |
| Bunny CDN | 14-tägige Testphase | 9,50 $/Monat pauschal | Eingeschränkt |
| Imgix | Keiner | 25 $/Monat | Ja |

**Unser Vorteil:** Null Build-Schritte, Git-nativer Workflow, automatische Formatkonvertierung beim Push, KI-gestützter Dokumentationsassistent und Cloudflares über 300 PoP-Edge-Netzwerk — alles bereits im kostenlosen Tarif enthalten.

## Abrechnung
- Standardmäßig monatliche Abrechnung. Jährliche Abrechnung spart 20 %.
- Kostenloser Tarif: keine Kreditkarte, keine Ablauffrist.
- Pro-Trial: 14 Tage, voller Funktionszugriff, keine Kreditkarte.
- Mehrverbrauch: am Zyklusende abgerechnet, niemals Dienstunterbrechung mitten im Zyklus.
- Jederzeit kündbar. Keine langfristigen Verträge. Daten bleiben nach der Kündigung 30 Tage lang zugänglich.

## Fair-Use-Richtlinie
CloudCDN ist für die Auslieferung statischer Assets konzipiert: Bilder, Icons, Schriftarten und Dokumente. Es ist nicht für Video-Streaming (Dateien über 25 MB), die Verteilung von Anwendungs-Binärdateien oder Datei-Hosting vorgesehen. Konten, die die Fair-Use-Richtlinie überschreiten, werden kontaktiert, um einen passenden Tarif zu besprechen. Wir werden niemals ohne Vorankündigung sperren.
