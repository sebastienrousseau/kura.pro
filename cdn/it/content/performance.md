# CloudCDN — Prestazioni

## Rete edge
CloudCDN è costruito sulla rete globale di Cloudflare:
- **Oltre 300 data center** in più di 100 paesi e oltre 193 città.
- **Il 95% della popolazione mondiale** si trova entro 50 ms da un PoP Cloudflare.
- **Oltre 8.000 interconnessioni di rete** per un routing ottimale.
- Il routing anycast indirizza automaticamente le richieste al PoP più vicino.

## Latenza
| Regione | TTFB mediano (cache hit) | TTFB P95 |
|---------|--------------------------|----------|
| Nord America | <30 ms | <80 ms |
| Europa | <35 ms | <90 ms |
| Asia Pacifico | <50 ms | <120 ms |
| Sud America | <60 ms | <150 ms |
| Africa | <80 ms | <200 ms |

Questi sono i tempi di hit della cache edge. La prima richiesta a un PoP richiede il fetch dall'origine (aggiunge 50-200 ms una volta).

## Strategia di caching
Tutti gli asset utilizzano un caching immutabile aggressivo:
```
Cache-Control: public, max-age=31536000, immutable
```

Questo significa:
- **Cache del browser:** 1 anno. Nessuna richiesta di rivalidazione.
- **Cache edge del CDN:** 1 anno. Servito dal PoP più vicino.
- **Rapporto di hit della cache:** >95% per gli asset di produzione.
- **Cache-busting:** modifica il nome file/percorso per servire asset aggiornati.

Il file manifest.json utilizza un caching a breve termine:
```
Cache-Control: public, max-age=300
```

## Compressione delle immagini

### Confronto dei formati
| Formato | Dimensione tipica (vs PNG) | Supporto del browser | Caso d'uso |
|---------|---------------------------|---------------------|------------|
| PNG | Riferimento (100%) | 100% | Senza perdite, trasparenza |
| WebP | ~40% di PNG | 97% | Distribuzione web generale |
| AVIF | ~30% di PNG | 93% | Massima compressione |
| SVG | Variabile | 100% | Grafica vettoriale, icone |

### Impostazioni di conversione automatica
- **WebP:** qualità 80, lossy. Miglior equilibrio tra qualità e dimensione.
- **AVIF:** qualità 65, lossy. Massima compressione con buona fedeltà visiva.
- Gli originali (PNG/JPEG) sono sempre conservati insieme alle varianti generate.

### Risparmi nel mondo reale
Per un progetto tipico con 50 icone (da 16x16 a 512x512):
- Totale PNG: ~5 MB
- Totale WebP: ~2 MB (riduzione del 60%)
- Totale AVIF: ~1,5 MB (riduzione del 70%)

Per le immagini banner (1200x630):
- PNG: ~500 KB in media
- WebP: ~150 KB in media
- AVIF: ~90 KB in media

## Impatto sui Core Web Vitals
Servire immagini ottimizzate tramite CloudCDN migliora direttamente:

### LCP (Largest Contentful Paint)
- Obiettivo: <2,5 secondi.
- Impatto: servire AVIF invece di PNG può ridurre l'LCP del 40-60% per le pagine ricche di immagini.
- Suggerimento: precarica le immagini above-the-fold con `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Obiettivo: <0,1.
- Impatto: imposta sempre gli attributi `width` e `height` sui tag `<img>` per riservare lo spazio.
- Suggerimento: usa il campo `size` di manifest.json per i calcoli del layout responsivo.

### INP (Interaction to Next Paint)
- Obiettivo: <200 ms.
- Impatto: immagini più piccole significano meno lavoro di decodifica sul thread principale.
- Suggerimento: usa `loading="lazy"` sulle immagini below-the-fold per ridurre il peso iniziale della pagina.

## Prestazioni di deployment
| Metrica | Valore |
|---------|--------|
| Deploy incrementale (1-10 file modificati) | 5-15 secondi |
| Deploy completo (oltre 10.000 file) | 30-60 secondi |
| Compressione delle immagini (per PNG, CI) | ~200 ms |
| Generazione del manifest (oltre 10.000 asset) | <5 secondi |

I deploy utilizzano la deduplicazione basata su content-hash — vengono caricati solo i file nuovi o modificati. Dopo il deploy iniziale, i push successivi caricano tipicamente solo i file modificati.

## Monitoraggio
- **Cloudflare Analytics:** disponibile nella dashboard di Cloudflare → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions:** i log di build e deploy sono disponibili nella tab Actions.
- **Stato:** la homepage (cloudcdn.pro) mostra lo stato operativo.

## Suggerimenti per l'ottimizzazione
1. **Usa URL AVIF** dove possibile — sono il 70% più piccoli di PNG.
2. **Usa l'elemento `<picture>`** per il fallback di formato (AVIF → WebP → PNG).
3. **Precarica le immagini critiche** above-the-fold.
4. **Carica in modo lazy tutto ciò che è below-the-fold** con `loading="lazy"`.
5. **Imposta dimensioni esplicite** su tutti i tag `<img>` per prevenire il layout shift.
6. **Usa la dimensione di icona più piccola necessaria** — non servire 512x512 quando bastano 64x64.
7. **Piano Pro:** usa `?format=auto` per lasciare che CloudCDN serva automaticamente il formato ottimale.
