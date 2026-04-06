# CloudCDN — Resolución de problemas

## Activo no se carga (404)

### Síntoma
`https://cloudcdn.pro/proyecto/image.webp` devuelve 404.

### Causas habituales
1. **Archivo aún no subido.** Comprueba `git status`: ¿está el archivo committeado y subido?
2. **Despliegue todavía en curso.** El despliegue de GitHub Actions tarda entre 30 y 90 segundos. Consulta la pestaña Actions.
3. **Ruta incorrecta.** Las URL distinguen mayúsculas y minúsculas. `Logo.webp` no es lo mismo que `logo.webp`.
4. **WebP/AVIF aún no generados.** La conversión automática se ejecuta al hacer push. Si has subido un PNG, las variantes `.webp` y `.avif` aparecen una vez que la action compress-images termine.
5. **Archivo de más de 25 MB.** Los archivos que superan los 25 MB se excluyen de la entrega CDN. Comprueba el tamaño con `ls -lh`.

### Solución
```bash
# Verificar que el archivo existe en el repo
git ls-files | grep tu-archivo

# Comprobar el estado de las Actions
gh run list --limit 5

# Probar la URL directamente
curl -sI https://cloudcdn.pro/proyecto/images/logo.webp
```

## Falla la firma del commit

### Síntoma
```
error: Signing failed: agent refused operation
```

### Causas habituales
1. **El agente SSH no está en ejecución.** Inícialo:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Clave hardware no tocada.** Si usas una YubiKey o clave de seguridad (Ed25519-SK), toca la llave cuando se te indique.
3. **Clave de firma incorrecta configurada.** Verifica:
   ```bash
   git config --global user.signingkey
   ```
4. **Clave SSH no añadida a GitHub.** Ve a GitHub → Settings → SSH and GPG keys. Asegúrate de que tu clave aparece como **Signing Key** (no solo de autenticación).

## WebP/AVIF no se genera

### Síntoma
Has subido un PNG pero no aparece ninguna variante `.webp` o `.avif`.

### Causas habituales
1. **La action de compresión no se activó.** El workflow solo se activa con archivos PNG/JPEG nuevos. Si el archivo ya existía, no se reprocesa. Consulta la pestaña Actions.
2. **El archivo no se detectó como nuevo.** El workflow usa `git diff HEAD~1` para encontrar archivos nuevos. Si has hecho amend de un commit, el diff puede no detectarlo.
3. **Conversión de Sharp fallida.** Algunos PNG malformados o perfiles de color inusuales pueden provocar errores de conversión. Consulta los logs de la action.

### Solución
Ejecuta el script de conversión localmente:
```bash
cd scripts && npm install
node convert.mjs ../../tu-proyecto
```

## Contenido obsoleto tras hacer push

### Síntoma
Has subido una imagen actualizada pero la versión anterior sigue sirviéndose.

### Causa
Los activos se almacenan en caché con cabeceras `immutable` durante 1 año. Actualizar un archivo en la misma URL no invalida las cachés.

### Solución
**Cambia el nombre del archivo o la ruta.** Es así por diseño: la caché inmutable es la estrategia de entrega más rápida.
```bash
# En lugar de actualizar logo.png, usa nombres versionados:
logo-v2.png
# O basados en fecha:
logo-2026-03.png
```

Los clientes Pro/Enterprise pueden purgar URL específicas mediante el panel de Cloudflare.

## Falla el despliegue (GitHub Actions)

### Síntoma
La action "Deploy to Cloudflare Pages" falla.

### Causas habituales
1. **Token de API no válido.** El token puede haber caducado o haberse rotado. Actualiza `CLOUDFLARE_API_TOKEN` en GitHub Secrets.
2. **Permisos faltantes.** El token necesita: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **Archivo de más de 25 MB.** El workflow de despliegue elimina automáticamente los archivos de más de 25 MB, pero revisa los logs en busca de errores.
4. **Problema del servicio de Cloudflare.** Consulta cloudflarestatus.com.

### Solución
```bash
# Volver a ejecutar el workflow fallido
gh run rerun <run-id>

# Consultar los logs
gh run view <run-id> --log-failed
```

## El manifiesto no se actualiza

### Síntoma
Los nuevos activos no aparecen en `manifest.json` ni en el panel.

### Causa
El generador del manifiesto se activa con cambios en las rutas de imagen. Si has subido archivos fuera de las rutas esperadas, puede no activarse.

### Solución
Actívalo manualmente:
```bash
gh workflow run generate-manifest
```
O regenera localmente:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Límite de ancho de banda alcanzado (plan gratuito)

### Síntoma
Los activos devuelven errores o dejan de cargarse a mitad de mes.

### Causa
El plan gratuito tiene 10 GB/mes de ancho de banda. Recibirás un aviso por correo al alcanzar el 80 % de uso.

### Solución
- Optimiza más las imágenes (usa URL AVIF en vez de PNG para una reducción de ~70 %).
- Mejora a Pro (29 $/mes) para obtener 100 GB/mes.
- Espera al mes siguiente: los límites se reinician el día 1.

## El chat del Concierge no responde

### Síntoma
El widget de chat IA en la página de inicio no responde o muestra errores.

### Causas habituales
1. **Límite mensual de consultas alcanzado (1.000/mes).** El Concierge se desactiva automáticamente al alcanzar el límite.
2. **Cloudflare Workers AI temporalmente no disponible.** Es raro, pero la inferencia IA en el edge puede sufrir interrupciones breves.
3. **Base de conocimiento no sincronizada.** Si los archivos de contenido se han actualizado recientemente, el índice de Vectorize puede necesitar resincronización.

### Solución
Para problemas de sincronización de la base de conocimiento:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
