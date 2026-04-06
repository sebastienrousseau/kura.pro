# CloudCDN im Vergleich zu Imgix

## Auf einen Blick

| Funktion | CloudCDN | Imgix |
|----------|----------|-------|
| **Einstiegspreis** | 29 $/Monat (Pro) | 25 $/Monat (Basic) |
| **Kostenloser Tarif** | 10 GB/Monat Bandbreite | Keiner |
| **Abrechnungsmodell** | Bandbreite (GB) | Origin-Bilder + Bandbreite |
| **Workflow** | Git-nativ (git push) | Dashboard / API / SDK |
| **Auto-Optimierung** | WebP + AVIF + JXL beim Push | Nur on-the-fly |
| **Transformationsparameter** | 9 (Resize, Format, Blur, Sharpen, Gravity, Fit, Quality) | Über 400 |
| **KI-Funktionen** | Semantische Suche + RAG-Concierge + MCP-Server | Gesichtserkennung, Auto-Crop |
| **Signierte Commits** | Pflicht (Lieferketten-Integrität) | Nicht zutreffend |
| **Edge-Standorte** | Über 300 (Cloudflare) | Imgix-CDN (etwa 50 PoPs) |
| **TTFB** | Median unter 50 ms (NA/EU) | Typischerweise 60 bis 100 ms |
| **JPEG XL** | Unterstützt (automatisch beim Push erzeugt) | Unterstützt |
| **Asset-Provenienz** | Kryptografisch (signierte Git-Commits) | Keine |
| **MCP-Server** | Integriert | Nicht verfügbar |

## Wann CloudCDN wählen

- Sie wollen einen **kostenlosen Tarif** (Imgix bietet keinen)
- Sie wollen einen **Git-nativen Workflow** ganz ohne SDKs
- Sie benötigen **kryptografische Asset-Provenienz** zur Compliance
- Sie liefern überwiegend statische Markenassets aus und brauchen keine 400 Transformationsparameter
- Sie wollen **KI-Agent-Integration** über MCP

## Wann Imgix wählen

- Sie benötigen **mehr als 400 Transformationsparameter** für komplexe Bild-Pipelines
- Sie benötigen **Echtzeit-Rendering** von benutzergenerierten Inhalten
- Sie benötigen **Purging nach URL-Mustern** (regex-basiert)
- Ihre Bilder liegen in S3/GCS und Sie benötigen einen Verarbeitungs-Proxy

## Kostenvergleich

Für eine Website mit 500 Quellbildern und 50 GB/Monat Auslieferung:

- **CloudCDN Pro**: 29 $/Monat
- **Imgix Basic**: 25 $/Monat + Mehrverbrauch bei Bandbreite

Für mehr als 1.000 Quellbilder:

- **CloudCDN Pro**: 29 $/Monat (unbegrenzte Quellbilder)
- **Imgix Growth**: 95 $/Monat (1.500 Origin-Bilder enthalten)
