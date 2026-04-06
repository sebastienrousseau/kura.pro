# Prezzi di CloudCDN (2026)

## Confronto dei piani

| Caratteristica | Free | Pro (29 $/mese) | Enterprise (personalizzato) |
|----------------|------|----------------|-----------------------------|
| Banda | 10 GB/mese | 100 GB/mese | Illimitata |
| Storage | File illimitati | File illimitati | Storage dedicato |
| Formati di immagine | Conversione automatica WebP + AVIF | WebP + AVIF + controlli di qualità | Suite completa + batch |
| Trasformazioni di immagini | Nessuna | Resize, crop, format tramite URL | API completa + elaborazione batch |
| Domini personalizzati | Non inclusi | Fino a 5 (SSL automatico) | Illimitati |
| Analytics | Nessuno | Dashboard di base | In tempo reale per asset/regione |
| Supporto | Community / GitHub Issues | Email prioritaria (SLA 24 ore) | Manager dedicato + Slack |
| SLA | Best-effort (~99,9%) | 99,9% di uptime garantito | 99,99% + crediti finanziari |
| Commit firmati | Obbligatori | Obbligatori | Obbligatori |
| SSO/SAML | No | No | Sì |
| Log di audit | No | No | Sì |

## Piano gratuito (open-source)
- **Target:** progetti personali, software open-source, hobbisti.
- **Costo:** 0 $/mese — gratuito per sempre, nessuna carta di credito richiesta.
- **Banda:** 10 GB/mese. Gli asset smettono di essere serviti tramite CDN se superata (i file rimangono in git).
- **Asset:** file statici illimitati (PNG, WebP, AVIF, SVG, ICO).
- **Ottimizzazione automatica:** ogni PNG/JPEG caricato viene convertito automaticamente in WebP (qualità 80) e AVIF (qualità 65).
- **Consegna:** TTFB inferiore a 100 ms dai 300+ PoP edge di Cloudflare. Caching immutabile (max-age di 1 anno).
- **Limitazioni:** nessun dominio personalizzato, nessuna API di trasformazione delle immagini, nessuna dashboard di analytics.

## Piano Pro
- **Target:** progetti commerciali, startup, siti web ad alto traffico.
- **Costo:** 29 $/mese (o 278 $/anno — risparmio del 20%).
- **Banda:** 100 GB/mese inclusi. Superamento: 0,05 $/GB fatturato a fine ciclo.
- **API di trasformazione delle immagini:** ridimensiona, ritaglia e converti al volo tramite parametri URL:
  ```
  https://cloudcdn.pro/progetto/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Negoziazione del formato:** servizio automatico AVIF/WebP basato sull'header `Accept` del browser.
- **Domini personalizzati:** fino a 5 domini con provisioning SSL automatico.
- **Supporto prioritario:** supporto email con garanzia di risposta entro 24 ore.
- **SLA:** 99,9% di uptime. In caso di violazione, 10% di credito di servizio per ogni 0,1% al di sotto della soglia.
- **Analytics:** banda, conteggio richieste, rapporto di hit della cache, distribuzione dei formati.
- **Prova gratuita di 14 giorni** con accesso completo. Nessuna carta di credito richiesta.

## Piano Enterprise
- **Target:** piattaforme globali, aziende dei media, e-commerce su larga scala.
- **Costo:** prezzo personalizzato — contatta sales@cloudcdn.pro.
- **Banda:** illimitata con allocazione edge dedicata.
- **Suite API completa:** tutte le trasformazioni Pro più elaborazione batch, notifiche webhook e upload programmatici.
- **Domini personalizzati:** illimitati con SSL wildcard.
- **Supporto dedicato:** account manager nominato, canale Slack privato, SLA di risposta di 1 ora.
- **SLA:** 99,99% di uptime. Crediti finanziari: 25% per <99,99%, 50% per <99,9%, 100% per <99,0%.
- **Sicurezza:** SSO/SAML, log di audit con conservazione di 12 mesi, allowlist IP.
- **Analytics:** dashboard in tempo reale con suddivisioni per asset, regione e formato.
- **Compliance:** DPA GDPR disponibile, opzioni di residenza dei dati (UE/USA).

## Come ci confrontiamo

| Provider | Piano gratuito | Piano a pagamento iniziale | API di trasformazione |
|----------|----------------|---------------------------|----------------------|
| **CloudCDN** | 10 GB/mese | 29 $/mese (100 GB) | Sì (Pro+) |
| Cloudflare Images | 5K trasformazioni/mese | Pay-as-you-go | Sì |
| ImageKit | 25 GB/mese | 9 $/mese | Sì |
| Cloudinary | ~5K trasformazioni/mese | 89 $/mese | Sì (oltre 300 parametri) |
| Bunny CDN | Prova di 14 giorni | 9,50 $/mese fisso | Limitato |
| Imgix | Nessuno | 25 $/mese | Sì |

**Il nostro vantaggio:** zero step di build, workflow Git-nativo, conversione automatica del formato al push, assistente di documentazione basato sull'IA e la rete edge di oltre 300 PoP di Cloudflare — tutto incluso dal piano gratuito.

## Fatturazione
- Fatturazione mensile per impostazione predefinita. La fatturazione annuale fa risparmiare il 20%.
- Piano gratuito: nessuna carta di credito, nessuna scadenza di prova.
- Prova Pro: 14 giorni, accesso completo alle funzionalità, nessuna carta di credito.
- Superamento: fatturato a fine ciclo, nessuna interruzione del servizio a metà ciclo.
- Cancella in qualsiasi momento. Nessun contratto a lungo termine. I dati rimangono accessibili per 30 giorni dopo la cancellazione.

## Politica di uso equo
CloudCDN è progettato per servire asset statici: immagini, icone, font e documenti. Non è destinato allo streaming video (file >25 MB), alla distribuzione di binari di applicazione o all'hosting di file. Gli account che superano l'uso equo verranno contattati per discutere un piano appropriato. Non sospenderemo mai senza preavviso.
