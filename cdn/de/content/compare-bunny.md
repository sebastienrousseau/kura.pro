# CloudCDN im Vergleich zu Bunny CDN

## Auf einen Blick

| Funktion | CloudCDN | Bunny CDN |
|----------|----------|-----------|
| **Einstiegspreis** | 29 $/Monat (Pro) | 9,50 $/Monat pauschal |
| **Kostenloser Tarif** | 10 GB/Monat Bandbreite | Nur 14-tägige Testphase |
| **Abrechnungsmodell** | Bandbreitenstufen | Pro GB (Volumenpreise ab 0,01 $/GB) |
| **Workflow** | Git-nativ (git push) | Dashboard / FTP / API |
| **Auto-Optimierung** | WebP + AVIF + JXL beim Push | Bunny Optimizer (separates Add-on) |
| **Storage-API** | Bunny.net-kompatibles JSON-Schema | Nativ |
| **KI-Funktionen** | Semantische Suche + RAG-Concierge + MCP-Server | Keine |
| **Signierte Commits** | Pflicht (Lieferketten-Integrität) | Nicht zutreffend |
| **Edge-Standorte** | Über 300 (Cloudflare) | 114 PoPs |
| **TTFB** | Median unter 50 ms (NA/EU) | Typischerweise 40 bis 80 ms |
| **Edge Compute** | Cloudflare Workers (vollständige JS-Runtime) | Bunny Script (eingeschränkt) |
| **Perma-Cache** | Unveränderliche 1-Jahres-Header | Perma-Cache-Funktion |
| **JPEG XL** | Unterstützt | Im Optimizer nicht verfügbar |
| **Asset-Provenienz** | Kryptografisch (signierte Git-Commits) | Keine |
| **MCP-Server** | Integriert | Nicht verfügbar |

## Warum CloudCDN Bunny-kompatible APIs verwendet

Die Storage-API von CloudCDN gibt ein Bunny.net-kompatibles JSON-Schema zurück (Guid, StorageZoneName, Path, ObjectName usw.). Das bedeutet, dass Migrations-Tools und Skripte, die für Bunny entwickelt wurden, ohne Anpassung mit CloudCDN funktionieren.

## Wann CloudCDN wählen

- Sie wollen einen **Git-nativen Workflow** (kein FTP, keine Dashboard-Uploads)
- Sie benötigen **KI-gestützte Suche** und **Agent-Integration** (MCP)
- Sie benötigen **kryptografische Provenienz** für jedes Asset
- Sie wollen **JPEG-XL-Auto-Generierung** zusätzlich zu WebP und AVIF
- Sie wollen einen **dauerhaften kostenlosen Tarif** (Bunnys Trial läuft aus)

## Wann Bunny CDN wählen

- Sie benötigen den **niedrigstmöglichen Preis pro GB** (0,01 $/GB in einigen Regionen)
- Sie benötigen **FTP/SFTP-Zugriff** auf Ihren Speicher
- Sie benötigen **Bunny Stream** für Video-Hosting
- Sie haben sehr hohe Bandbreite (mehr als 100 TB/Monat) und benötigen Mengenrabatte
- Sie benötigen **DDoS-Schutz** als Add-on mit eigenen Regeln

## Kostenvergleich

Für eine Website, die 50 GB/Monat ausliefert:

- **CloudCDN Pro**: 29 $/Monat
- **Bunny CDN**: ca. 2,50 $/Monat (EU/US bei 0,05 $/GB) + 0,50 $/Monat Speicher

Für 500 GB/Monat:

- **CloudCDN Pro**: 29 $ + (400 GB × 0,05 $) = 49 $/Monat
- **Bunny CDN**: ca. 25 $/Monat (EU/US) + Speicher

Bunny gewinnt bei den reinen Bandbreitenkosten. CloudCDN gewinnt beim Workflow, den KI-Funktionen, der Provenienz und dem kostenlosen Tarif.
