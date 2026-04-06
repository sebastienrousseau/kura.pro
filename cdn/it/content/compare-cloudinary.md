# CloudCDN vs Cloudinary

## In sintesi

| Caratteristica | CloudCDN | Cloudinary |
|----------------|----------|------------|
| **Prezzo iniziale** | 29 $/mese (Pro) | 89 $/mese (Plus) |
| **Piano gratuito** | 10 GB/mese di banda | 25 crediti/mese (~5K trasformazioni) |
| **Modello di fatturazione** | Banda (GB) | Basato su crediti (complesso) |
| **Workflow** | Git-nativo (git push) | Upload da dashboard/SDK/API |
| **Ottimizzazione automatica** | WebP + AVIF + JXL al push | Solo al volo |
| **Funzionalità IA** | Ricerca semantica + concierge RAG | Rimozione sfondo IA, riempimento generativo |
| **Commit firmati** | Obbligatori (integrità della supply chain) | Non applicabile |
| **Località edge** | Oltre 300 (Cloudflare) | ~60 PoP CDN |
| **TTFB** | <50 ms mediano (NA/UE) | ~80-120 ms tipico |
| **Domini personalizzati** | 5 (Pro), illimitati (Enterprise) | Illimitati (piani a pagamento) |
| **SLA** | 99,9% (Pro), 99,99% (Enterprise) | 99,9% (Business+) |
| **SSO/SAML** | Enterprise | Enterprise |
| **Server MCP** | Integrato (integrazione con agenti IA) | Non disponibile |
| **Provenienza degli asset** | Crittografica (commit Git firmati) | Solo timestamp di upload |

## Quando scegliere CloudCDN

- Vuoi un **workflow Git-nativo** — niente dashboard, niente SDK, solo `git push`
- Hai bisogno di **provenienza crittografica** per ogni asset (compliance, audit trail)
- Vuoi una **fatturazione semplice basata sulla banda** (niente calcoli di crediti)
- Servi **asset statici** (loghi, icone, banner, immagini) e vuoi un TTFB inferiore a 50 ms
- Vuoi **ricerca degli asset basata sull'IA** e un **server MCP** per workflow guidati da agenti

## Quando scegliere Cloudinary

- Hai bisogno di **IA avanzata per le immagini** (rimozione sfondo, riempimento generativo, ritaglio automatico)
- Hai bisogno di **transcodifica video** con streaming adattivo
- Hai bisogno di **oltre 400 parametri di trasformazione** per pipeline di immagini complesse
- Hai un'integrazione Cloudinary esistente con SDK

## Confronto dei costi

Per un sito che serve 50 GB/mese di asset statici:

- **CloudCDN Pro**: 29 $/mese fisso
- **Cloudinary Plus**: 89 $/mese + potenziale superamento dei crediti

Per 200 GB/mese:

- **CloudCDN Pro**: 29 $ + (100 GB di superamento × 0,05 $) = 34 $/mese
- **Cloudinary Advanced**: 224 $/mese
