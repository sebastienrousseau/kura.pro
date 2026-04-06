# CloudCDN — Risoluzione dei problemi

## Asset non caricato (404)

### Sintomo
`https://cloudcdn.pro/progetto/image.webp` restituisce 404.

### Cause comuni
1. **File non ancora caricato.** Controlla `git status` — il file è committato e caricato?
2. **Deploy ancora in corso.** Il deploy di GitHub Actions richiede 30-90 secondi. Controlla la tab Actions.
3. **Percorso errato.** Gli URL sono sensibili alle maiuscole/minuscole. `Logo.webp` non è `logo.webp`.
4. **WebP/AVIF non ancora generato.** La conversione automatica viene eseguita al push. Se hai caricato un PNG, le varianti `.webp` e `.avif` appaiono dopo il completamento dell'Action compress-images.
5. **File oltre i 25 MB.** I file che superano i 25 MB sono esclusi dalla consegna CDN. Controlla la dimensione del file con `ls -lh`.

### Soluzione
```bash
# Verifica che il file esista nel repository
git ls-files | grep your-file

# Controlla lo stato delle Actions
gh run list --limit 5

# Testa l'URL direttamente
curl -sI https://cloudcdn.pro/progetto/images/logo.webp
```

## La firma del commit fallisce

### Sintomo
```
error: Signing failed: agent refused operation
```

### Cause comuni
1. **SSH agent non in esecuzione.** Avvialo:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Chiave hardware non toccata.** Se usi una YubiKey o una chiave di sicurezza (Ed25519-SK), tocca la chiave quando richiesto.
3. **Chiave di firma errata configurata.** Verifica:
   ```bash
   git config --global user.signingkey
   ```
4. **Chiave SSH non aggiunta a GitHub.** Vai su GitHub → Settings → SSH and GPG keys. Assicurati che la tua chiave sia elencata come **Signing Key** (non solo Authentication).

## WebP/AVIF non generato

### Sintomo
Hai caricato un PNG ma non è apparsa nessuna variante `.webp` o `.avif`.

### Cause comuni
1. **L'Action di compressione non si è attivata.** Il workflow si attiva solo su nuovi file PNG/JPEG. Se il file esisteva già, non verrà rielaborato. Controlla la tab Actions.
2. **File non rilevato come nuovo.** Il workflow utilizza `git diff HEAD~1` per trovare nuovi file. Se hai modificato un commit, il diff potrebbe non rilevarlo.
3. **Conversione Sharp fallita.** Alcuni PNG malformati o profili colore insoliti possono causare errori di conversione. Controlla i log dell'Action.

### Soluzione
Esegui manualmente lo script di conversione locale:
```bash
cd scripts && npm install
node convert.mjs ../../your-project
```

## Contenuto obsoleto dopo il push

### Sintomo
Hai caricato un'immagine aggiornata ma viene ancora servita la vecchia versione.

### Causa
Gli asset sono memorizzati nella cache con header `immutable` per 1 anno. Aggiornare un file allo stesso URL non invalida le cache.

### Soluzione
**Cambia il nome del file o il percorso.** Questo è intenzionale — il caching immutabile è la strategia di consegna più veloce.
```bash
# Invece di aggiornare logo.png, usa nomi versionati:
logo-v2.png
# O basati sulla data:
logo-2026-03.png
```

I clienti Pro/Enterprise possono purgare URL specifici tramite la dashboard di Cloudflare.

## Il deploy fallisce (GitHub Actions)

### Sintomo
L'Action "Deploy to Cloudflare Pages" fallisce.

### Cause comuni
1. **Token API non valido.** Il token potrebbe essere scaduto o ruotato. Aggiorna `CLOUDFLARE_API_TOKEN` nei GitHub Secrets.
2. **Permessi mancanti.** Il token necessita di: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **File oltre i 25 MB.** Il workflow di deploy rimuove automaticamente i file >25 MB, ma controlla i log per gli errori.
4. **Problema del servizio Cloudflare.** Controlla cloudflarestatus.com.

### Soluzione
```bash
# Riesegui il workflow fallito
gh run rerun <run-id>

# Controlla i log
gh run view <run-id> --log-failed
```

## Manifest non aggiornato

### Sintomo
I nuovi asset non appaiono in `manifest.json` o nella dashboard.

### Causa
Il generatore del manifest si attiva su modifiche ai percorsi delle immagini. Se hai caricato file al di fuori dei percorsi attesi, potrebbe non attivarsi.

### Soluzione
Attivalo manualmente:
```bash
gh workflow run generate-manifest
```
Oppure rigeneralo localmente:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Limite di banda raggiunto (piano gratuito)

### Sintomo
Gli asset restituiscono errori o smettono di caricarsi a metà mese.

### Causa
Il piano gratuito ha 10 GB/mese di banda. Riceverai un'email all'80% di utilizzo.

### Soluzione
- Ottimizza ulteriormente le immagini (usa URL AVIF invece di PNG per una riduzione del ~70%).
- Esegui l'upgrade a Pro (29 $/mese) per 100 GB/mese.
- Attendi il mese successivo — i limiti si resettano il 1°.

## La chat del Concierge non risponde

### Sintomo
Il widget di chat IA sulla homepage non risponde o mostra errori.

### Cause comuni
1. **Limite di query mensili raggiunto (1.000/mese).** Il Concierge si disabilita quando viene raggiunto il limite.
2. **Cloudflare Workers AI temporaneamente non disponibile.** Raro, ma l'inferenza IA edge può subire brevi interruzioni.
3. **Knowledge base non sincronizzata.** Se i file di contenuto sono stati aggiornati di recente, l'indice Vectorize potrebbe necessitare di una nuova sincronizzazione.

### Soluzione
Per problemi di sincronizzazione della knowledge base:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
