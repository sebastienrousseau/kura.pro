# Informazioni su CloudCDN

## Cos'è CloudCDN?
CloudCDN è una rete di distribuzione di asset statici Git-nativa per sviluppatori. Carica le immagini in un repository GitHub e vengono automaticamente ottimizzate e servite a livello globale dalla rete edge di Cloudflare: oltre 300 data center, più di 100 paesi, latenza inferiore a 100 ms.

A differenza dei tradizionali CDN per immagini che richiedono dashboard, API di upload o integrazioni SDK, CloudCDN utilizza il flusso di lavoro che gli sviluppatori già conoscono: `git push`.

## Come funziona
1. **Push:** aggiungi le immagini al repository GitHub e fai commit con una chiave firmata.
2. **Ottimizza:** GitHub Actions comprime automaticamente le immagini e genera varianti WebP (qualità 80, ~60% più leggere) e AVIF (qualità 65, ~70% più leggere).
3. **Deploy:** i file modificati vengono caricati su Cloudflare Pages tramite deploy incrementale (deduplica per hash di contenuto: vengono trasferiti solo i file nuovi o modificati).
4. **Distribuzione:** gli asset vengono serviti con header di cache immutabili (`max-age=31536000`) dal punto edge più vicino tra gli oltre 300 disponibili.

## Stack tecnologico
- **Rete edge:** Cloudflare Pages su oltre 300 PoP globali. Il 95% della popolazione mondiale si trova a meno di 50 ms da un data center Cloudflare.
- **Formati di immagine:** PNG (originale senza perdita), WebP (con perdita, qualità 80), AVIF (con perdita, qualità 65), SVG (passthrough), ICO (passthrough).
- **Negoziazione del formato:** il piano Pro serve il formato ottimale in base all'header `Accept` del browser (AVIF > WebP > originale).
- **Caching:** caching immutabile edge e browser con max-age di un anno. Cache-busting tramite modifica del nome o del percorso del file.
- **CI/CD:** GitHub Actions per compressione (Sharp), generazione del manifest e deploy su Cloudflare Pages (Wrangler).
- **Sicurezza:** commit firmati SSH Ed25519 obbligatori. Branch protection sul ramo `main`. Token API crittografati tramite GitHub Secrets.
- **Concierge IA:** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG per la ricerca intelligente nella documentazione dalla home page.

## Prestazioni
- **TTFB:** mediana inferiore a 50 ms in Nord America/Europa, inferiore a 100 ms a livello globale (cache hit edge Cloudflare).
- **Tasso di hit della cache:** superiore al 95% per gli asset di produzione (caching immutabile).
- **Velocità di deploy:** upload incrementali — vengono trasferiti solo i file modificati. Deploy tipico: 5-30 secondi.
- **Compressione:** WebP risparmia circa il 60% rispetto al PNG. AVIF risparmia circa il 70% rispetto al PNG. Entrambi vengono generati automaticamente.

## Organizzazione degli asset
```
project-name/
  images/
    banners/    — Grafica in formato wide (1200x630 consigliato)
    icons/      — Multi-risoluzione (da 16x16 a 512x512, con @2x/@3x)
    logos/      — Logo e marchi del brand
    github/     — Immagini di anteprima social
    titles/     — Grafica per titoli e header
  README.md     — Descrizione opzionale del progetto
```

## Metriche chiave
- **Oltre 1.400 asset ottimizzati** distribuiti su 54 zone tenant.
- **Una sola sorgente per immagine** — le derivate vengono generate su richiesta tramite `/api/transform`.
- **Oltre 300 PoP edge** in più di 100 paesi.
- **TTFB globale inferiore a 100 ms** sui cache hit edge.
- **Nessuno step di build** — niente `npm install`, niente webpack, nessun framework richiesto.

## Chi usa CloudCDN?
CloudCDN serve asset per:
- **Progetti open source:** logo, banner, icone e grafica per la documentazione.
- **Strumenti per sviluppatori:** branding di sviluppatori Rust, Python e IA (rustdev, pythondev, llamadev).
- **Piattaforme fintech:** librerie di asset per banking e quantum computing.
- **Applicazioni audio:** visualizzazioni di forme d'onda e componenti UI.
- **Generatori di siti statici:** Shokunin, Kaishi e altri framework SSG.

## Perché non [concorrente]?

| vs Cloudinary | vs Imgix | vs Bunny CDN |
|---|---|---|
| Nessuna complessità del sistema di crediti | Nessuna fatturazione basata su crediti | Supporto AVIF incluso |
| Workflow Git-nativo | Workflow Git-nativo | Workflow Git-nativo |
| Piano gratuito, senza carta di credito | Piano gratuito disponibile | Nessuna scadenza della prova |
| Concierge IA integrato | Solo documentazione standard | Solo documentazione standard |

## Open source
L'infrastruttura del CDN è open source con licenza MIT. Repository: github.com/sebastienrousseau/cloudcdn.pro.

## Contatti
- **Supporto:** support@cloudcdn.pro
- **Vendite:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **Stato:** cloudcdn.pro (la home page mostra lo stato operativo)
