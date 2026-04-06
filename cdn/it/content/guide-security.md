# CloudCDN — Guida alla sicurezza

## Panoramica
CloudCDN impone i commit firmati su tutti i push al branch main. Questo garantisce che ogni modifica agli asset sia verificata crittograficamente e tracciabile a un contributore specifico.

## Perché i commit firmati?
- **Integrità:** garantisce che gli asset non siano stati manomessi durante il transito.
- **Audit trail:** ogni modifica è collegata a un'identità verificata.
- **Sicurezza della supply chain:** previene modifiche non autorizzate ai contenuti serviti dal CDN.
- **Compliance:** soddisfa i requisiti di sicurezza enterprise per la provenienza degli asset.

## Configurazione delle chiavi SSH (raccomandato)

### Generare una chiave Ed25519
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

Per chiavi di sicurezza hardware (YubiKey, ecc.):
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### Configurare Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Aggiungere la chiave a GitHub
1. Copia la tua chiave pubblica: `cat ~/.ssh/id_ed25519.pub`
2. Vai su GitHub → Settings → SSH and GPG keys → New SSH key
3. Seleziona **Signing Key** come tipo di chiave
4. Incolla e salva

### Verificare
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## Configurazione delle chiavi GPG (alternativa)

### Generare una chiave GPG
```bash
gpg --full-generate-key
```
Seleziona RSA a 4096 bit, imposta una scadenza e inserisci la tua email.

### Configurare Git
```bash
gpg --list-secret-keys --keyid-format=long
# Copia l'ID della chiave (ad esempio, 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Aggiungere la chiave a GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
Copia l'output e aggiungilo in GitHub → Settings → SSH and GPG keys → New GPG key.

## Protezione del branch
Il branch main è protetto con le seguenti regole:
- **Commit firmati richiesti:** tutti i commit devono essere firmati crittograficamente.
- **Nessun force push:** la cronologia non può essere riscritta.
- **Nessuna eliminazione del branch:** il branch main non può essere eliminato.

## Sicurezza dei token API
Per i workflow CI/CD, i token API sono archiviati come GitHub Secrets:
- `CLOUDFLARE_API_TOKEN` — Utilizzato per il deployment di Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — L'identificatore del tuo account Cloudflare.

Non inserire mai token API, segreti o credenziali nel repository. Utilizza GitHub Secrets per tutti i valori sensibili.

## Best practice di sicurezza
1. Utilizza chiavi di sicurezza hardware (Ed25519-SK) quando possibile.
2. Ruota i token API trimestralmente.
3. Esamina il log di audit di GitHub per accessi imprevisti.
4. Abilita l'autenticazione a due fattori sul tuo account GitHub.
5. Usa il comando `git log --show-signature` per verificare le firme dei commit.
