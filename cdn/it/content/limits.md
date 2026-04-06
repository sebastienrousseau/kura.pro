# CloudCDN — Limiti e quote

## Limiti dei file
| Limite | Valore |
|--------|--------|
| Dimensione massima del file (consegna CDN) | 25 MB |
| Dimensione massima del file (repository Git) | Nessun limite rigido (GitHub LFS disponibile) |
| Formati di immagine supportati | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Formati video supportati | MP4 (≤25 MB) |
| Lunghezza massima del nome file | 255 caratteri |
| Sensibilità maiuscole/minuscole degli URL | Sì — i percorsi sono sensibili alle maiuscole/minuscole |

## Limiti di banda
| Piano | Banda mensile | Superamento |
|-------|---------------|-------------|
| Free | 10 GB | Il servizio si interrompe fino al mese successivo |
| Pro | 100 GB | 0,05 $/GB |
| Enterprise | Illimitato | N/A |

La banda è misurata come byte consegnati dall'edge agli utenti finali. I pull dall'origine, i trasferimenti CI/CD e le chiamate API del Concierge non vengono conteggiati.

## Limiti di deployment
| Limite | Valore |
|--------|--------|
| Numero massimo di file per deployment | 20.000 |
| Dimensione massima del deployment | Nessun limite rigido (upload incrementali) |
| Deployment concorrenti | 1 (in coda se sovrapposti) |
| Frequenza di deployment | Nessun limite (attivato a ogni push a main) |

## Limiti di trasformazione delle immagini (Pro+)
| Limite | Pro | Enterprise |
|--------|-----|-----------|
| Trasformazioni/mese | 50.000 | Illimitate |
| Dimensioni massime di output | 8192 x 8192 px | 8192 x 8192 px |
| Parametro di qualità massimo | 100 | 100 |
| Raggio massimo di sfocatura | 250 | 250 |
| Formati di output supportati | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## Limiti API e di velocità
| Endpoint | Limite |
|----------|--------|
| Consegna degli asset | Illimitato (edge Cloudflare) |
| manifest.json | Illimitato (cache edge di 5 minuti) |
| API chat del Concierge | 1.000 query/mese (tutti i piani) |
| API di purga della cache (Pro+) | 1.000 purghe/giorno |

## Domini personalizzati
| Piano | Domini personalizzati |
|-------|----------------------|
| Free | 0 |
| Pro | Fino a 5 |
| Enterprise | Illimitati (inclusi wildcard) |

## Storage
Non c'è una quota di storage — puoi caricare file illimitati nel repository. Il limite pratico è dato dalle raccomandazioni sulle dimensioni del repository di GitHub (idealmente sotto i 5 GB, con GitHub LFS per repository più grandi).

## Conversione automatica
| Limite | Valore |
|--------|--------|
| Formati generati per upload | 2 (WebP + AVIF) |
| Conversioni concorrenti massime (CI) | Basato sul runner GitHub Actions (2 core CPU) |
| Timeout di conversione | 6 ore (limite di GitHub Actions) |

## Concierge IA
| Limite | Valore |
|--------|--------|
| Query mensili | 1.000 |
| Query per sessione (lato client) | 100 |
| Cronologia delle conversazioni | Solo sessione corrente (non persistente) |
| Dimensione della knowledge base | 5 documenti di contenuto, ~30 chunk |
| Token massimi della risposta | 512 |

## Cosa succede al raggiungimento dei limiti
- **Banda superata (Free):** gli asset smettono di essere serviti fino al mese successivo. Email di avviso all'80%.
- **Banda superata (Pro):** il superamento viene fatturato a 0,05 $/GB. Nessuna interruzione del servizio.
- **Limite del Concierge raggiunto:** il widget di chat si disabilita per il mese.
- **Limite di trasformazione raggiunto (Pro):** le trasformazioni restituiscono il formato originale fino al mese successivo.
- **File troppo grande:** i file >25 MB sono esclusi dal CDN ma rimangono in Git.
