# CloudCDN im Vergleich zu Cloudinary

## Auf einen Blick

| Funktion | CloudCDN | Cloudinary |
|----------|----------|------------|
| **Einstiegspreis** | 29 $/Monat (Pro) | 89 $/Monat (Plus) |
| **Kostenloser Tarif** | 10 GB/Monat Bandbreite | 25 Credits/Monat (~5.000 Transformationen) |
| **Abrechnungsmodell** | Bandbreite (GB) | Credit-basiert (komplex) |
| **Workflow** | Git-nativ (git push) | Dashboard / SDK / API-Upload |
| **Auto-Optimierung** | WebP + AVIF + JXL beim Push | Nur on-the-fly |
| **KI-Funktionen** | Semantische Suche + RAG-Concierge | KI-Hintergrundentfernung, Generative Fill |
| **Signierte Commits** | Pflicht (Lieferketten-Integrität) | Nicht zutreffend |
| **Edge-Standorte** | Über 300 (Cloudflare) | Etwa 60 CDN-PoPs |
| **TTFB** | Median unter 50 ms (NA/EU) | Typischerweise 80 bis 120 ms |
| **Eigene Domains** | 5 (Pro), unbegrenzt (Enterprise) | Unbegrenzt (kostenpflichtige Tarife) |
| **SLA** | 99,9 % (Pro), 99,99 % (Enterprise) | 99,9 % (Business und höher) |
| **SSO/SAML** | Enterprise | Enterprise |
| **MCP-Server** | Integriert (KI-Agent-Integration) | Nicht verfügbar |
| **Asset-Provenienz** | Kryptografisch (signierte Git-Commits) | Nur Upload-Zeitstempel |

## Wann CloudCDN wählen

- Sie wollen einen **Git-nativen Workflow** — kein Dashboard, kein SDK, einfach `git push`
- Sie benötigen **kryptografische Provenienz** für jedes Asset (Compliance, Audit-Trail)
- Sie wollen eine **einfache Bandbreitenabrechnung** (keine Credit-Mathematik)
- Sie liefern **statische Assets** (Logos, Icons, Banner, Bilder) und wollen TTFB unter 50 ms
- Sie wollen **KI-gestützte Asset-Suche** und einen **MCP-Server** für agentengetriebene Workflows

## Wann Cloudinary wählen

- Sie benötigen **fortgeschrittene Bild-KI** (Hintergrundentfernung, Generative Fill, Auto-Crop)
- Sie benötigen **Video-Transcoding** mit adaptivem Streaming
- Sie benötigen **mehr als 400 Transformationsparameter** für komplexe Bild-Pipelines
- Sie haben bereits eine bestehende Cloudinary-Integration mit SDKs

## Kostenvergleich

Für eine Website, die 50 GB/Monat statische Assets ausliefert:

- **CloudCDN Pro**: 29 $/Monat pauschal
- **Cloudinary Plus**: 89 $/Monat + möglicher Mehrverbrauch bei Credits

Für 200 GB/Monat:

- **CloudCDN Pro**: 29 $ + (100 GB Mehrverbrauch × 0,05 $) = 34 $/Monat
- **Cloudinary Advanced**: 224 $/Monat
