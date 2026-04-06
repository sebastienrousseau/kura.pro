# CloudCDN vs Imgix

## In sintesi

| Caratteristica | CloudCDN | Imgix |
|----------------|----------|-------|
| **Prezzo iniziale** | 29 $/mese (Pro) | 25 $/mese (Basic) |
| **Piano gratuito** | 10 GB/mese di banda | Nessuno |
| **Modello di fatturazione** | Banda (GB) | Immagini di origine + banda |
| **Workflow** | Git-nativo (git push) | Dashboard/API/SDK |
| **Ottimizzazione automatica** | WebP + AVIF + JXL al push | Solo al volo |
| **Parametri di trasformazione** | 9 (resize, format, blur, sharpen, gravity, fit, quality) | Oltre 400 |
| **Funzionalità IA** | Ricerca semantica + concierge RAG + server MCP | Rilevamento volti, auto-crop |
| **Commit firmati** | Obbligatori (integrità della supply chain) | Non applicabile |
| **Località edge** | Oltre 300 (Cloudflare) | CDN Imgix (~50 PoP) |
| **TTFB** | <50 ms mediano (NA/UE) | ~60-100 ms tipico |
| **JPEG XL** | Supportato (generato automaticamente al push) | Supportato |
| **Provenienza degli asset** | Crittografica (commit Git firmati) | Nessuna |
| **Server MCP** | Integrato | Non disponibile |

## Quando scegliere CloudCDN

- Vuoi un **piano gratuito** (Imgix non ne ha uno)
- Vuoi un **workflow Git-nativo** senza SDK
- Hai bisogno di **provenienza crittografica degli asset** per la compliance
- Servi principalmente asset statici di brand e non hai bisogno di 400 parametri di trasformazione
- Vuoi **integrazione con agenti IA** tramite MCP

## Quando scegliere Imgix

- Hai bisogno di **oltre 400 parametri di trasformazione** per pipeline di immagini complesse
- Hai bisogno di **rendering in tempo reale** dei contenuti caricati dagli utenti
- Hai bisogno di **purga per pattern URL** (basato su regex)
- Le tue immagini sono archiviate in S3/GCS e hai bisogno di un proxy di elaborazione

## Confronto dei costi

Per un sito con 500 immagini sorgente e 50 GB/mese di consegna:

- **CloudCDN Pro**: 29 $/mese
- **Imgix Basic**: 25 $/mese + superamento della banda

Per oltre 1.000 immagini sorgente:

- **CloudCDN Pro**: 29 $/mese (immagini sorgente illimitate)
- **Imgix Growth**: 95 $/mese (1.500 immagini di origine incluse)
