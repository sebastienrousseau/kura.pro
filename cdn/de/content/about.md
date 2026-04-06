# Über CloudCDN

## Was ist CloudCDN?
CloudCDN ist ein Git-natives Content Delivery Network für statische Assets – für Entwicklerinnen und Entwickler. Schieben Sie Bilder in ein GitHub-Repository, und sie werden automatisch optimiert und weltweit über das Edge-Netzwerk von Cloudflare ausgeliefert: über 300 Rechenzentren, mehr als 100 Länder, eine Latenz unter 100 ms.

Im Gegensatz zu klassischen Bild-CDNs, die Dashboards, Upload-APIs oder SDK-Integrationen voraussetzen, nutzt CloudCDN den Workflow, den Entwickelnde ohnehin schon kennen: `git push`.

## So funktioniert es
1. **Pushen:** Fügen Sie Bilder zum GitHub-Repository hinzu und committen Sie mit einem signierten Schlüssel.
2. **Optimieren:** GitHub Actions komprimiert die Bilder automatisch und erzeugt WebP-Varianten (Qualität 80, ca. 60 % kleiner) und AVIF-Varianten (Qualität 65, ca. 70 % kleiner).
3. **Deployen:** Geänderte Dateien werden per Inkrementellem Deploy auf Cloudflare Pages hochgeladen (Deduplizierung per Content-Hash – nur neue oder geänderte Dateien werden übertragen).
4. **Ausliefern:** Die Assets werden mit unveränderlichen Cache-Headern (`max-age=31536000`) vom nächstgelegenen der über 300 Edge-Standorte ausgeliefert.

## Technologie-Stack
- **Edge-Netzwerk:** Cloudflare Pages auf über 300 globalen PoPs. 95 % der Weltbevölkerung befinden sich weniger als 50 ms von einem Cloudflare-Rechenzentrum entfernt.
- **Bildformate:** PNG (verlustfreies Original), WebP (verlustbehaftet, Qualität 80), AVIF (verlustbehaftet, Qualität 65), SVG (unverändert durchgereicht), ICO (unverändert durchgereicht).
- **Format-Aushandlung:** Der Pro-Tarif liefert anhand des `Accept`-Headers des Browsers das optimale Format aus (AVIF > WebP > Original).
- **Caching:** Unveränderliches Edge- und Browser-Caching mit einem max-age von einem Jahr. Cache-Busting per Dateiname- oder Pfadänderung.
- **CI/CD:** GitHub Actions für Komprimierung (Sharp), Manifest-Generierung und Cloudflare-Pages-Deployment (Wrangler).
- **Sicherheit:** Signierte Commits per SSH Ed25519 sind Pflicht. Branch Protection auf `main`. Verschlüsselte API-Token über GitHub Secrets.
- **KI-Concierge:** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG für intelligente Dokumentationssuche auf der Startseite.

## Leistung
- **TTFB:** Median unter 50 ms in Nordamerika/Europa, weltweit unter 100 ms (bei einem Treffer im Cloudflare-Edge-Cache).
- **Cache-Trefferquote:** Über 95 % bei Produktions-Assets (unveränderliches Caching).
- **Deploy-Geschwindigkeit:** Inkrementelle Uploads – nur geänderte Dateien werden übertragen. Typischer Deploy: 5 bis 30 Sekunden.
- **Komprimierung:** WebP spart etwa 60 % gegenüber PNG. AVIF spart etwa 70 % gegenüber PNG. Beide werden automatisch erzeugt.

## Asset-Organisation
```
project-name/
  images/
    banners/    — Breitformat-Grafiken (1200x630 empfohlen)
    icons/      — Multi-Auflösung (16x16 bis 512x512, mit @2x/@3x)
    logos/      — Markenlogos und Wortmarken
    github/     — Social-Preview-Bilder
    titles/     — Titelgrafiken und Header
  README.md     — Optionale Projektbeschreibung
```

## Kennzahlen
- **Über 1.400 optimierte Assets** verteilt auf 54 Mandanten-Zonen.
- **Eine einzige Quelle pro Bild** – Varianten werden bei Bedarf über `/api/transform` erzeugt.
- **Über 300 Edge-PoPs** in mehr als 100 Ländern.
- **Globale TTFB unter 100 ms** bei einem Treffer im Edge-Cache.
- **Null Build-Schritte** – kein `npm install`, kein Webpack, kein Framework erforderlich.

## Wer nutzt CloudCDN?
CloudCDN liefert Assets für:
- **Open-Source-Projekte:** Logos, Banner, Icons und Dokumentationsgrafiken.
- **Entwickler-Tools:** Rust-, Python- und KI-Entwickler-Branding (rustdev, pythondev, llamadev).
- **Fintech-Plattformen:** Asset-Bibliotheken für Banking und Quantum Computing.
- **Audio-Anwendungen:** Waveform-Visualisierungen und UI-Komponenten.
- **Static-Site-Generatoren:** Shokunin, Kaishi und weitere SSG-Frameworks.

## Warum nicht [Mitbewerber]?

| vs. Cloudinary | vs. Imgix | vs. Bunny CDN |
|---|---|---|
| Kein komplexes Credit-System | Keine credit-basierte Abrechnung | AVIF-Unterstützung inklusive |
| Git-nativer Workflow | Git-nativer Workflow | Git-nativer Workflow |
| Kostenloser Tarif, keine Kreditkarte | Kostenloser Tarif verfügbar | Keine Ablauffrist im Trial |
| Integrierter KI-Concierge | Nur Standard-Dokumentation | Nur Standard-Dokumentation |

## Open Source
Die CDN-Infrastruktur ist unter der MIT-Lizenz Open Source. Repository: github.com/sebastienrousseau/cloudcdn.pro.

## Kontakt
- **Support:** support@cloudcdn.pro
- **Sales:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **Status:** cloudcdn.pro (die Startseite zeigt den Betriebsstatus)
