# CloudCDN — Cumplimiento y privacidad

## Tratamiento de datos

### ¿Qué datos maneja CloudCDN?
CloudCDN sirve archivos estáticos (imágenes, iconos, fuentes). No procesa, almacena ni transmite datos personales de usuarios. El único flujo de datos es:
1. Un navegador solicita la URL de un archivo estático.
2. El edge de Cloudflare sirve el archivo desde caché.
3. Se generan registros HTTP estándar (IP, marca de tiempo, URL, user-agent).

### ¿Dónde se almacenan los datos?
- **Archivos fuente:** repositorio GitHub (alojado en EE. UU. por GitHub/Microsoft).
- **Caché edge:** los más de 300 PoP globales de Cloudflare. Las copias en caché se distribuyen por todo el mundo para mejorar el rendimiento.
- **Datos del Concierge IA:** las conversaciones no se almacenan. El widget de chat utiliza únicamente estado de sesión en memoria; no hay registro en el servidor de las consultas del usuario.
- **Contadores de límite de tasa:** almacenados en Cloudflare Workers KV (solo recuentos agregados, sin datos personales).

## Cumplimiento del RGPD

### Estado
CloudCDN cumple con el RGPD. Utilizamos Cloudflare como proveedor de infraestructura, que mantiene el cumplimiento del RGPD mediante:
- Certificación en el Marco de Privacidad de Datos UE-EE. UU.
- Cláusulas Contractuales Estándar (SCC) para transferencias internacionales de datos.
- Acuerdos de Tratamiento de Datos disponibles bajo petición.

### Minimización de datos
- CloudCDN no establece cookies.
- No hay seguimiento de usuarios ni píxeles de analítica.
- No se recopilan, almacenan ni procesan datos personales.
- Los registros de acceso HTTP los gestiona Cloudflare según su política de privacidad.

### Derechos de los interesados
Como CloudCDN no recopila datos personales, no hay datos personales a los que acceder, corregir o eliminar. Si crees que tus datos personales se han incluido por error en un activo (por ejemplo, una foto), ponte en contacto con support@cloudcdn.pro para su eliminación.

### DPA (Acuerdo de Tratamiento de Datos)
Los clientes Enterprise pueden solicitar un DPA formal. Contacta con sales@cloudcdn.pro.

## CCPA / CPRA (California)
CloudCDN no vende, comparte ni utiliza información personal para publicidad dirigida. No se requiere ningún mecanismo de exclusión, ya que no se recopilan datos personales.

## SOC 2 / ISO 27001
CloudCDN aprovecha la infraestructura de Cloudflare, que mantiene:
- Certificación SOC 2 Type II.
- Certificación ISO 27001.
- Cumplimiento PCI DSS Level 1.
Estas certificaciones cubren la infraestructura de entrega edge utilizada por CloudCDN.

## Medidas de seguridad
- **Cifrado en tránsito:** TLS 1.3 en todas las conexiones.
- **Protección DDoS:** mitigación DDoS automática de Cloudflare en todos los planes.
- **WAF:** firewall de aplicaciones web de Cloudflare activo en todos los endpoints.
- **Mitigación de bots:** Cloudflare Bot Management protege contra el scraping y el abuso.
- **Commits firmados:** todas las modificaciones de activos requieren verificación criptográfica.
- **Protección de ramas:** los force pushes y la reescritura del historial están bloqueados.
- **Gestión de secretos:** los tokens de API se almacenan como GitHub Secrets cifrados, nunca en el código.

## Integridad de los activos
Cada activo servido por CloudCDN es rastreable hasta un commit Git firmado. Esto proporciona:
- **Procedencia:** cada cambio de archivo está vinculado a un colaborador verificado.
- **Pista de auditoría:** historial completo de Git con verificación de commits firmados.
- **Detección de manipulación:** cualquier modificación no autorizada rompe la cadena de firmas.

## Uso aceptable
CloudCDN está destinado únicamente a la entrega de activos estáticos. Los usos prohibidos incluyen:
- Alojar malware o contenido de phishing.
- Streaming de vídeo o distribución de archivos grandes (más de 25 MB).
- Almacenar datos personales, credenciales o información sensible en los activos.
- Usar el servicio para eludir los términos de otros servicios.

Las infracciones conllevan la suspensión de la cuenta con un preaviso de 24 horas (excepto el contenido ilegal, que se elimina de inmediato).

## Respuesta ante incidentes
- Los incidentes de seguridad se notifican en un plazo de 72 horas según los requisitos del RGPD.
- Contacta con security@cloudcdn.pro para informar de vulnerabilidades.
- Los clientes Enterprise reciben notificaciones directas a través de su canal Slack dedicado.

## Contacto
- **Consultas de privacidad:** privacy@cloudcdn.pro
- **Informes de seguridad:** security@cloudcdn.pro
- **Solicitudes de DPA:** sales@cloudcdn.pro
