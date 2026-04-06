# CloudCDN — Guía de seguridad

## Visión general
CloudCDN exige commits firmados en todos los push a la rama `main`. Esto garantiza que cada cambio de activo está verificado criptográficamente y es rastreable hasta un colaborador específico.

## ¿Por qué commits firmados?
- **Integridad:** garantiza que los activos no se han manipulado en tránsito.
- **Pista de auditoría:** cada cambio está vinculado a una identidad verificada.
- **Seguridad de la cadena de suministro:** previene modificaciones no autorizadas del contenido servido por el CDN.
- **Cumplimiento:** cumple con los requisitos de seguridad empresarial sobre procedencia de activos.

## Configuración de clave SSH (recomendada)

### Generar una clave Ed25519
```bash
ssh-keygen -t ed25519 -C "tu@email.com" -f ~/.ssh/id_ed25519
```

Para claves de seguridad por hardware (YubiKey, etc.):
```bash
ssh-keygen -t ed25519-sk -C "tu@email.com"
```

### Configurar Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Añadir la clave a GitHub
1. Copia tu clave pública: `cat ~/.ssh/id_ed25519.pub`
2. Ve a GitHub → Settings → SSH and GPG keys → New SSH key
3. Selecciona **Signing Key** como tipo de clave
4. Pega y guarda

### Verificar
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## Configuración de clave GPG (alternativa)

### Generar una clave GPG
```bash
gpg --full-generate-key
```
Selecciona RSA 4096 bits, define una fecha de caducidad e introduce tu correo electrónico.

### Configurar Git
```bash
gpg --list-secret-keys --keyid-format=long
# Copia el identificador de clave (por ejemplo, 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Añadir la clave a GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
Copia la salida y añádela en GitHub → Settings → SSH and GPG keys → New GPG key.

## Protección de ramas
La rama `main` está protegida con las siguientes reglas:
- **Commits firmados obligatorios:** todos los commits deben estar firmados criptográficamente.
- **Sin force pushes:** el historial no puede reescribirse.
- **Sin eliminación de la rama:** la rama `main` no se puede eliminar.

## Seguridad de los tokens de API
Para los flujos de CI/CD, los tokens de API se almacenan como GitHub Secrets:
- `CLOUDFLARE_API_TOKEN` — se utiliza para el despliegue en Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — tu identificador de cuenta de Cloudflare.

Nunca subas tokens de API, secretos o credenciales al repositorio. Usa GitHub Secrets para todos los valores sensibles.

## Buenas prácticas de seguridad
1. Utiliza claves de seguridad por hardware (Ed25519-SK) cuando sea posible.
2. Rota los tokens de API trimestralmente.
3. Revisa el registro de auditoría de GitHub en busca de accesos inesperados.
4. Activa la autenticación de dos factores en tu cuenta de GitHub.
5. Utiliza el comando `git log --show-signature` para verificar las firmas de los commits.
