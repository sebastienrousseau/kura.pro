# CloudCDN — Domande frequenti

## Per iniziare

### Cos'è CloudCDN?
CloudCDN è un CDN di immagini Git-nativo. Carica le immagini in un repository GitHub e vengono automaticamente ottimizzate (WebP + AVIF) e servite globalmente dalle oltre 300 località edge di Cloudflare con latenza inferiore a 100 ms.

### In cosa si differenzia CloudCDN da Cloudinary o Imgix?
CloudCDN utilizza un workflow Git-nativo — niente upload da dashboard, niente SDK, niente sistemi a crediti. Esegui `git push` e i tuoi asset sono online. Cloudinary utilizza una fatturazione basata su crediti a partire da 89 $/mese per i piani a pagamento. Imgix utilizza pacchetti di crediti a partire da 25 $/mese. Il piano Pro di CloudCDN è di 29 $/mese con una fatturazione semplice basata sulla banda.

### CloudCDN è gratuito per i progetti open-source?
Sì. Il piano gratuito è permanentemente gratuito con 10 GB/mese di banda. Nessuna carta di credito, nessuna scadenza di prova. Ideale per loghi, banner, icone e asset di documentazione di progetti OSS.

### Devo installare qualcosa?
No. Hai solo bisogno di Git (2.34+) e di una chiave SSH per i commit firmati. Niente Node.js, niente gestori di pacchetti, niente strumenti di build. La pipeline CI/CD gestisce tutta l'ottimizzazione delle immagini lato server.

## Formati di file

### Quali formati di file sono supportati?
Upload: PNG, JPEG, SVG, ICO, WebP. La pipeline genera automaticamente varianti WebP e AVIF per tutti gli upload PNG e JPEG. I file SVG e ICO vengono serviti così come sono.

### Quali impostazioni di qualità vengono utilizzate per la conversione automatica?
WebP: qualità 80 (quasi senza perdite, ~60% più piccolo del PNG). AVIF: qualità 65 (alta efficienza, ~70% più piccolo del PNG). Sono ottimizzati per il miglior equilibrio tra qualità visiva e dimensione del file.

### Posso sovrascrivere le impostazioni di qualità?
Sul piano Pro, l'API di trasformazione delle immagini supporta qualità personalizzata tramite parametri URL: `?q=90` per qualità superiore, `?q=50` per maggiore compressione. Il piano gratuito utilizza le impostazioni predefinite.

### E JPEG XL?
Nel 2026, JPEG XL è dietro un flag in Chrome e Firefox, con supporto parziale in Safari. Aggiungeremo la conversione automatica JPEG XL una volta che il supporto del browser supererà l'80%. Attualmente, AVIF offre una compressione migliore con una compatibilità più ampia (oltre il 93% di supporto del browser).

### Qual è la dimensione massima del file?
25 MB per file per la consegna CDN. I file di oltre 25 MB rimangono nel repository Git ma sono esclusi dal deployment edge. Per riferimento, un PNG 4K di alta qualità è tipicamente di 5-15 MB.

## Prestazioni

### Quanto è veloce la consegna degli asset?
TTFB mediano inferiore a 50 ms in Nord America ed Europa, inferiore a 100 ms a livello globale. Gli asset vengono serviti con header di cache immutabili (max-age di 1 anno), quindi le visite ripetute vengono servite direttamente dalla cache del browser.

### Come funziona la cache?
Tutti gli asset vengono serviti con `Cache-Control: public, max-age=31536000, immutable`. I browser e gli edge CDN memorizzano i file nella cache per un anno. Per aggiornare un asset, modifica il nome del file (ad esempio, `logo-v2.webp`) — questo è l'approccio standard di cache-busting.

### Qual è il rapporto di hit della cache?
Gli asset di produzione vedono tipicamente un rapporto di hit della cache superiore al 95%. Il file manifest.json viene memorizzato nella cache per 5 minuti per rimanere aggiornato. La dashboard non viene mai memorizzata nella cache.

### Posso purgare la cache manualmente?
Piano gratuito: le purghe della cache avvengono automaticamente al deploy. Pro/Enterprise: puoi purgare URL specifici o pattern wildcard tramite la dashboard di Cloudflare o l'API.

## API di trasformazione delle immagini (Pro+)

### Come funziona l'API di trasformazione?
Aggiungi parametri URL a qualsiasi URL di asset:
```
https://cloudcdn.pro/progetto/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### Quali parametri sono disponibili?
- `w` — Larghezza in pixel (ad esempio, `?w=400`)
- `h` — Altezza in pixel (ad esempio, `?h=300`)
- `fit` — Modalità di ridimensionamento: `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Formato di output: `auto` (migliore per il browser), `webp`, `avif`, `png`, `jpeg`
- `q` — Qualità: 1-100 (il valore predefinito varia a seconda del formato)
- `blur` — Sfocatura gaussiana: 1-250 (ad esempio, `?blur=20` per il segnaposto LQIP)
- `sharpen` — Nitidezza: 1-10
- `gravity` — Punto di ancoraggio del ritaglio: `center`, `north`, `south`, `east`, `west`, `face` (IA)

### CloudCDN supporta la negoziazione automatica del formato?
Sì (Pro+). Quando usi `?format=auto`, CloudCDN legge l'header `Accept` del browser e serve AVIF (se supportato), poi WebP, poi il formato originale. Questo garantisce che ogni visitatore riceva il file più piccolo possibile.

## Setup e workflow

### Come carico gli asset?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
Entro 1-2 minuti, il tuo asset è online a `https://cloudcdn.pro/my-project/images/logos/my-logo.webp`.

### Posso usare un dominio personalizzato?
I piani Pro ed Enterprise supportano i domini personalizzati. I domini personalizzati ottengono il provisioning SSL automatico e la configurazione CNAME tramite Cloudflare DNS. Contatta support@cloudcdn.pro per la configurazione.

### Funziona su macOS, Linux e WSL2?
Sì. Tutte le piattaforme con Git e SSH. Consulta la Guida al Setup per le istruzioni specifiche della piattaforma, inclusa la generazione delle chiavi SSH e la configurazione della firma Git.

## Sicurezza

### I commit firmati sono obbligatori?
Sì. Tutti i push al branch main richiedono commit firmati (SSH Ed25519 o GPG). Questo garantisce che ogni modifica agli asset sia verificata crittograficamente. Consulta la Guida alla Sicurezza per la configurazione.

### I miei dati sono al sicuro?
Gli asset vengono serviti tramite HTTPS con TLS 1.3. Il repository di origine è su GitHub con protezione del branch. Cloudflare fornisce protezione DDoS, WAF e mitigazione dei bot su tutti i piani.

## Fatturazione

### Come funziona la fatturazione della banda?
Gratuito: 10 GB/mese. Pro: 100 GB/mese inclusi, 0,05 $/GB di superamento. Enterprise: illimitato. Banda = totale dei byte consegnati dall'edge agli utenti finali. I pull dall'origine e i trasferimenti CI/CD non vengono conteggiati.

### Posso fare upgrade o downgrade in qualsiasi momento?
Sì. Gli upgrade hanno effetto immediato (proporzionale). I downgrade hanno effetto al prossimo ciclo di fatturazione. Cancella in qualsiasi momento — nessun contratto.

### C'è una prova gratuita per Pro?
Sì. 14 giorni di prova ad accesso completo. Nessuna carta di credito richiesta. Torna automaticamente al piano gratuito se non ti abboni.

### Cosa succede se supero la banda del piano gratuito?
Gli asset smettono di essere serviti dal CDN per il resto del mese. Rimangono nel repository Git e riprendono a essere serviti all'inizio del mese successivo. Riceverai un'email di avviso all'80% di utilizzo.

## Conformità

### CloudCDN è conforme al GDPR?
Sì. CloudCDN utilizza l'infrastruttura di Cloudflare, che elabora i dati in conformità con il GDPR. Offriamo un Data Processing Agreement (DPA) per i clienti Enterprise. Nessun dato personale degli utenti viene archiviato — serviamo solo file statici.

### Dove vengono archiviati i dati?
I file degli asset sono archiviati nel repository GitHub (USA) e memorizzati nella cache nelle oltre 300 località edge globali di Cloudflare. Le copie memorizzate nella cache scadono dopo 1 anno o al nuovo deployment.
