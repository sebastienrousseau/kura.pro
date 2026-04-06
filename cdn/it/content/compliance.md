# CloudCDN — Conformità e privacy

## Trattamento dei dati

### Quali dati gestisce CloudCDN?
CloudCDN serve file statici (immagini, icone, font). Non elabora, archivia né trasmette dati personali degli utenti. L'unico flusso di dati è il seguente:
1. Un browser richiede l'URL di un file statico.
2. L'edge di Cloudflare serve il file memorizzato nella cache.
3. Vengono generati log HTTP standard (IP, timestamp, URL, user-agent).

### Dove vengono archiviati i dati?
- **File sorgente:** repository GitHub (ospitato negli Stati Uniti da GitHub/Microsoft).
- **Cache edge:** oltre 300 PoP globali di Cloudflare. Le copie memorizzate nella cache sono distribuite in tutto il mondo per le prestazioni.
- **Dati del Concierge IA:** le conversazioni non vengono archiviate. Il widget di chat utilizza solo lo stato della sessione in memoria — nessuna registrazione lato server delle query degli utenti.
- **Contatori di rate limiting:** archiviati in Cloudflare Workers KV (solo conteggi aggregati, nessun dato personale).

## Conformità al GDPR

### Stato
CloudCDN è conforme al GDPR. Utilizziamo Cloudflare come provider di infrastruttura, che mantiene la conformità al GDPR tramite:
- la certificazione al EU-US Data Privacy Framework;
- le clausole contrattuali standard (SCC) per i trasferimenti internazionali di dati;
- gli accordi di trattamento dei dati disponibili su richiesta.

### Minimizzazione dei dati
- CloudCDN non imposta alcun cookie.
- Nessun tracciamento degli utenti o pixel analitico.
- Nessun dato personale viene raccolto, archiviato o elaborato.
- I log di accesso HTTP sono gestiti da Cloudflare secondo la sua policy sulla privacy.

### Diritti degli interessati
Poiché CloudCDN non raccoglie dati personali, non ci sono dati personali da consultare, correggere o eliminare. Se ritieni che i tuoi dati personali siano stati inavvertitamente inclusi in un asset (ad esempio, una foto), contatta support@cloudcdn.pro per la rimozione.

### DPA (accordo sul trattamento dei dati)
I clienti Enterprise possono richiedere un DPA formale. Contatta sales@cloudcdn.pro.

## CCPA / CPRA (California)
CloudCDN non vende, condivide né utilizza informazioni personali per pubblicità mirata. Non è necessario alcun meccanismo di opt-out poiché non vengono raccolti dati personali.

## SOC 2 / ISO 27001
CloudCDN sfrutta l'infrastruttura di Cloudflare, che mantiene:
- la certificazione SOC 2 Type II;
- la certificazione ISO 27001;
- la conformità PCI DSS di livello 1.
Queste certificazioni coprono l'infrastruttura di consegna edge utilizzata da CloudCDN.

## Misure di sicurezza
- **Crittografia in transito:** TLS 1.3 su tutte le connessioni.
- **Protezione DDoS:** mitigazione DDoS automatica di Cloudflare su tutti i piani.
- **WAF:** Cloudflare Web Application Firewall attivo su tutti gli endpoint.
- **Mitigazione dei bot:** Cloudflare Bot Management protegge contro lo scraping e gli abusi.
- **Commit firmati:** tutte le modifiche agli asset richiedono la verifica crittografica.
- **Protezione dei branch:** i force push e le riscritture della cronologia sono bloccati.
- **Gestione dei segreti:** i token API sono archiviati come GitHub Secrets crittografati, mai nel codice.

## Integrità degli asset
Ogni asset servito da CloudCDN è tracciabile fino a un commit Git firmato. Questo fornisce:
- **Provenienza:** ogni modifica al file è collegata a un contributore verificato.
- **Audit trail:** cronologia Git completa con verifica dei commit firmati.
- **Rilevamento delle manomissioni:** qualsiasi modifica non autorizzata interrompe la catena di firme.

## Uso accettabile
CloudCDN è destinato esclusivamente alla consegna di asset statici. Gli usi vietati includono:
- L'hosting di malware o contenuti di phishing.
- Lo streaming video o la distribuzione di file di grandi dimensioni (oltre 25 MB).
- L'archiviazione di dati personali, credenziali o informazioni sensibili negli asset.
- L'uso del servizio per aggirare i termini di altri servizi.

Le violazioni comportano la sospensione dell'account con preavviso di 24 ore (eccetto per i contenuti illegali, che vengono rimossi immediatamente).

## Risposta agli incidenti
- Gli incidenti di sicurezza vengono segnalati entro 72 ore in conformità con i requisiti del GDPR.
- Contatta security@cloudcdn.pro per segnalare vulnerabilità.
- I clienti Enterprise ricevono notifiche dirette tramite il loro canale Slack dedicato.

## Contatti
- **Richieste sulla privacy:** privacy@cloudcdn.pro
- **Segnalazioni di sicurezza:** security@cloudcdn.pro
- **Richieste di DPA:** sales@cloudcdn.pro
