# CloudCDN — Limits und Kontingente

## Datei-Limits
| Limit | Wert |
|-------|------|
| Maximale Dateigröße (CDN-Auslieferung) | 25 MB |
| Maximale Dateigröße (Git-Repository) | Kein hartes Limit (GitHub LFS verfügbar) |
| Unterstützte Bildformate | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Unterstützte Videoformate | MP4 (≤ 25 MB) |
| Maximale Dateinamenlänge | 255 Zeichen |
| URL-Groß-/Kleinschreibung | Ja — Pfade beachten Groß-/Kleinschreibung |

## Bandbreiten-Limits
| Tarif | Monatliche Bandbreite | Mehrverbrauch |
|-------|----------------------|---------------|
| Kostenlos | 10 GB | Dienst pausiert bis zum nächsten Monat |
| Pro | 100 GB | 0,05 $/GB |
| Enterprise | Unbegrenzt | Nicht zutreffend |

Bandbreite wird als die Anzahl der vom Edge an Endbenutzer ausgelieferten Bytes gemessen. Origin-Pulls, CI/CD-Übertragungen und Concierge-API-Aufrufe werden nicht gezählt.

## Deployment-Limits
| Limit | Wert |
|-------|------|
| Maximale Dateien pro Deployment | 20.000 |
| Maximale Deployment-Größe | Keine harte Obergrenze (inkrementelle Uploads) |
| Gleichzeitige Deployments | 1 (in die Warteschlange gestellt bei Überschneidung) |
| Deployment-Häufigkeit | Kein Limit (wird bei jedem Push auf `main` ausgelöst) |

## Bildtransformations-Limits (Pro und höher)
| Limit | Pro | Enterprise |
|-------|-----|-----------|
| Transformationen pro Monat | 50.000 | Unbegrenzt |
| Maximale Ausgabedimensionen | 8192 × 8192 px | 8192 × 8192 px |
| Maximaler Qualitätsparameter | 100 | 100 |
| Maximaler Blur-Radius | 250 | 250 |
| Unterstützte Ausgabeformate | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## API- und Rate-Limits
| Endpoint | Limit |
|----------|-------|
| Asset-Auslieferung | Unbegrenzt (Cloudflare Edge) |
| manifest.json | Unbegrenzt (5-Minuten-Edge-Cache) |
| Concierge-Chat-API | 1.000 Anfragen/Monat (alle Tarife) |
| Cache-Purge-API (Pro und höher) | 1.000 Purges/Tag |

## Eigene Domains
| Tarif | Eigene Domains |
|-------|---------------|
| Kostenlos | 0 |
| Pro | Bis zu 5 |
| Enterprise | Unbegrenzt (einschließlich Wildcard) |

## Speicherplatz
Es gibt kein Speicherkontingent — Sie können beliebig viele Dateien in das Repository pushen. Das praktische Limit entspricht den Empfehlungen von GitHub für die Repository-Größe (idealerweise unter 5 GB, mit GitHub LFS für größere Repositories).

## Auto-Konvertierung
| Limit | Wert |
|-------|------|
| Pro Upload erzeugte Formate | 2 (WebP + AVIF) |
| Maximal gleichzeitige Konvertierungen (CI) | Abhängig vom GitHub-Actions-Runner (2 CPU-Kerne) |
| Konvertierungs-Timeout | 6 Stunden (GitHub-Actions-Limit) |

## Concierge-KI
| Limit | Wert |
|-------|------|
| Anfragen pro Monat | 1.000 |
| Anfragen pro Sitzung (clientseitig) | 100 |
| Konversationsverlauf | Nur aktuelle Sitzung (nicht persistent) |
| Wissensbasis-Größe | 5 Inhaltsdokumente, ca. 30 Chunks |
| Maximale Antworttoken | 512 |

## Was passiert bei Erreichen der Limits
- **Bandbreite überschritten (Kostenlos):** Assets werden bis zum nächsten Monat nicht mehr ausgeliefert. E-Mail-Warnung bei 80 %.
- **Bandbreite überschritten (Pro):** Mehrverbrauch wird mit 0,05 $/GB abgerechnet. Keine Dienstunterbrechung.
- **Concierge-Limit erreicht:** Das Chat-Widget wird für den Rest des Monats deaktiviert.
- **Transformations-Limit erreicht (Pro):** Transformationen liefern bis zum nächsten Monat das Originalformat zurück.
- **Datei zu groß:** Dateien über 25 MB werden vom CDN ausgeschlossen, verbleiben aber in Git.
