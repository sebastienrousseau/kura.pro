# CloudCDN — Performance

## Edge-Netzwerk
CloudCDN basiert auf dem globalen Netzwerk von Cloudflare:
- **Über 300 Rechenzentren** in mehr als 100 Ländern und über 193 Städten.
- **95 % der Weltbevölkerung** befinden sich weniger als 50 ms von einem Cloudflare-PoP entfernt.
- **Über 8.000 Netzwerk-Interconnects** für optimales Routing.
- Anycast-Routing leitet Anfragen automatisch an den nächstgelegenen PoP weiter.

## Latenz
| Region | Median-TTFB (Cache Hit) | P95-TTFB |
|--------|------------------------|----------|
| Nordamerika | < 30 ms | < 80 ms |
| Europa | < 35 ms | < 90 ms |
| Asien-Pazifik | < 50 ms | < 120 ms |
| Südamerika | < 60 ms | < 150 ms |
| Afrika | < 80 ms | < 200 ms |

Dies sind Edge-Cache-Hit-Zeiten. Die erste Anfrage an einen PoP erfordert einen Origin-Fetch (fügt einmalig 50 bis 200 ms hinzu).

## Caching-Strategie
Alle Assets verwenden aggressives, unveränderliches Caching:
```
Cache-Control: public, max-age=31536000, immutable
```

Das bedeutet:
- **Browser-Cache:** 1 Jahr. Keine Revalidierungsanfragen.
- **CDN-Edge-Cache:** 1 Jahr. Wird vom nächstgelegenen PoP ausgeliefert.
- **Cache-Trefferquote:** Über 95 % bei Produktions-Assets.
- **Cache-Busting:** Ändern Sie Dateinamen oder Pfad, um aktualisierte Assets auszuliefern.

Die manifest.json verwendet kurzes Caching:
```
Cache-Control: public, max-age=300
```

## Bildkomprimierung

### Formatvergleich
| Format | Typische Größe (vs. PNG) | Browser-Unterstützung | Anwendungsfall |
|--------|-------------------------|----------------------|----------------|
| PNG | Basis (100 %) | 100 % | Verlustfrei, Transparenz |
| WebP | ca. 40 % von PNG | 97 % | Allgemeine Web-Auslieferung |
| AVIF | ca. 30 % von PNG | 93 % | Maximale Komprimierung |
| SVG | Variabel | 100 % | Vektorgrafiken, Icons |

### Einstellungen für die Auto-Konvertierung
- **WebP:** Qualität 80, verlustbehaftet. Beste Balance zwischen Qualität und Größe.
- **AVIF:** Qualität 65, verlustbehaftet. Maximale Komprimierung mit guter visueller Treue.
- Die Originale (PNG/JPEG) werden immer parallel zu den erzeugten Varianten beibehalten.

### Reale Einsparungen
Für ein typisches Projekt mit 50 Icons (16x16 bis 512x512):
- PNG gesamt: ca. 5 MB
- WebP gesamt: ca. 2 MB (60 % Reduktion)
- AVIF gesamt: ca. 1,5 MB (70 % Reduktion)

Für Banner-Bilder (1200x630):
- PNG: ca. 500 KB im Durchschnitt
- WebP: ca. 150 KB im Durchschnitt
- AVIF: ca. 90 KB im Durchschnitt

## Auswirkungen auf die Core Web Vitals
Die Auslieferung optimierter Bilder über CloudCDN verbessert direkt:

### LCP (Largest Contentful Paint)
- Ziel: unter 2,5 Sekunden.
- Wirkung: Die Auslieferung von AVIF anstelle von PNG kann den LCP bei bildlastigen Seiten um 40 bis 60 % reduzieren.
- Tipp: Preloaden Sie Bilder above the fold mit `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Ziel: unter 0,1.
- Wirkung: Setzen Sie immer die Attribute `width` und `height` auf `<img>`-Tags, um Platz zu reservieren.
- Tipp: Verwenden Sie das Feld `size` aus der manifest.json für responsive Layoutberechnungen.

### INP (Interaction to Next Paint)
- Ziel: unter 200 ms.
- Wirkung: Kleinere Bilder bedeuten weniger Decoding-Arbeit auf dem Main Thread.
- Tipp: Verwenden Sie `loading="lazy"` für Bilder unterhalb des Folds, um das initiale Seitengewicht zu reduzieren.

## Deployment-Performance
| Metrik | Wert |
|--------|------|
| Inkrementeller Deploy (1 bis 10 geänderte Dateien) | 5 bis 15 Sekunden |
| Vollständiger Deploy (über 10.000 Dateien) | 30 bis 60 Sekunden |
| Bildkomprimierung (pro PNG, CI) | ca. 200 ms |
| Manifest-Generierung (über 10.000 Assets) | unter 5 Sekunden |

Deployments verwenden Deduplizierung per Content-Hash — nur neue oder geänderte Dateien werden hochgeladen. Nach dem ersten Deployment laden nachfolgende Pushes typischerweise nur die geänderten Dateien hoch.

## Monitoring
- **Cloudflare Analytics:** Verfügbar im Cloudflare-Dashboard → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions:** Build- und Deploy-Logs sind im Actions-Tab verfügbar.
- **Status:** Die Startseite (cloudcdn.pro) zeigt den Betriebsstatus an.

## Optimierungstipps
1. **Verwenden Sie nach Möglichkeit AVIF-URLs** — sie sind 70 % kleiner als PNG.
2. **Verwenden Sie das `<picture>`-Element** für Format-Fallback (AVIF → WebP → PNG).
3. **Preloaden Sie kritische Bilder** above the fold.
4. **Lazy-loaden Sie alles below the fold** mit `loading="lazy"`.
5. **Setzen Sie explizite Dimensionen** auf alle `<img>`-Tags, um Layout-Verschiebungen zu vermeiden.
6. **Verwenden Sie die kleinste benötigte Icon-Größe** — liefern Sie kein 512x512 aus, wenn 64x64 ausreicht.
7. **Pro-Tarif:** Verwenden Sie `?format=auto`, damit CloudCDN automatisch das optimale Format ausliefert.
