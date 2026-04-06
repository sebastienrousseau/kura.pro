# CloudCDN vs Bunny CDN

## In sintesi

| Caratteristica | CloudCDN | Bunny CDN |
|----------------|----------|-----------|
| **Prezzo iniziale** | 29 $/mese (Pro) | 9,50 $/mese fisso |
| **Piano gratuito** | 10 GB/mese di banda | Solo prova di 14 giorni |
| **Modello di fatturazione** | Fasce di banda | Per GB (prezzo a volume da 0,01 $/GB) |
| **Workflow** | Git-nativo (git push) | Dashboard/FTP/API |
| **Ottimizzazione automatica** | WebP + AVIF + JXL al push | Bunny Optimizer (componente aggiuntivo separato) |
| **API di Storage** | Schema JSON compatibile con Bunny.net | Nativo |
| **Funzionalità IA** | Ricerca semantica + concierge RAG + server MCP | Nessuna |
| **Commit firmati** | Obbligatori (integrità della supply chain) | Non applicabile |
| **Località edge** | Oltre 300 (Cloudflare) | 114 PoP |
| **TTFB** | <50 ms mediano (NA/UE) | ~40-80 ms tipico |
| **Edge compute** | Cloudflare Workers (runtime JS completo) | Bunny Script (limitato) |
| **Perma-Cache** | Header immutabili di 1 anno | Funzionalità Perma-Cache |
| **JPEG XL** | Supportato | Non disponibile in Optimizer |
| **Provenienza degli asset** | Crittografica (commit Git firmati) | Nessuna |
| **Server MCP** | Integrato | Non disponibile |

## Perché CloudCDN utilizza API compatibili con Bunny

L'API di Storage di CloudCDN restituisce uno schema JSON compatibile con Bunny.net (Guid, StorageZoneName, Path, ObjectName, ecc.). Ciò significa che gli strumenti di migrazione e gli script creati per Bunny funzionano con CloudCDN immediatamente.

## Quando scegliere CloudCDN

- Vuoi un **workflow Git-nativo** (niente FTP, niente upload dalla dashboard)
- Hai bisogno di **ricerca basata sull'IA** e **integrazione con agenti** (MCP)
- Hai bisogno di **provenienza crittografica** per ogni asset
- Vuoi la generazione automatica di **JPEG XL** insieme a WebP e AVIF
- Vuoi un **piano gratuito permanente** (la prova di Bunny scade)

## Quando scegliere Bunny CDN

- Hai bisogno del **prezzo per GB più basso possibile** (0,01 $/GB in alcune regioni)
- Hai bisogno di **accesso FTP/SFTP** al tuo storage
- Hai bisogno di **Bunny Stream** per l'hosting video
- Hai una banda molto elevata (oltre 100 TB/mese) e necessiti di sconti sul volume
- Hai bisogno di **protezione DDoS** come componente aggiuntivo con regole personalizzate

## Confronto dei costi

Per un sito che serve 50 GB/mese:

- **CloudCDN Pro**: 29 $/mese
- **Bunny CDN**: ~2,50 $/mese (UE/USA a 0,05 $/GB) + 0,50 $/mese di storage

Per 500 GB/mese:

- **CloudCDN Pro**: 29 $ + (400 GB × 0,05 $) = 49 $/mese
- **Bunny CDN**: ~25 $/mese (UE/USA) + storage

Bunny vince sul costo grezzo della banda. CloudCDN vince su workflow, funzionalità IA, provenienza e piano gratuito.
