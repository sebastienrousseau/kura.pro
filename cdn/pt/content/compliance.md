# CloudCDN — Conformidade e privacidade

## Tratamento de dados

### Quais dados o CloudCDN processa?
O CloudCDN entrega arquivos estáticos (imagens, ícones, fontes). Não processa, armazena nem transmite dados pessoais de usuários. O único fluxo de dados é:
1. Um navegador solicita a URL de um arquivo estático.
2. O edge do Cloudflare entrega o arquivo em cache.
3. Logs HTTP padrão são gerados (IP, timestamp, URL, user-agent).

### Onde os dados são armazenados?
- **Arquivos de origem:** repositório GitHub (hospedado nos EUA pelo GitHub/Microsoft).
- **Cache de edge:** os mais de 300 PoPs globais do Cloudflare. Cópias em cache são distribuídas mundialmente para desempenho.
- **Dados do Concierge de IA:** as conversas não são armazenadas. O widget de chat usa apenas estado de sessão em memória — sem registro de logs no servidor das consultas dos usuários.
- **Contadores de limite de taxa:** armazenados no Cloudflare Workers KV (apenas contagens agregadas, sem dados pessoais).

## Conformidade com o GDPR

### Status
O CloudCDN está em conformidade com o GDPR. Usamos a Cloudflare como provedora de infraestrutura, que mantém conformidade com o GDPR por meio de:
- certificação no EU-US Data Privacy Framework;
- cláusulas contratuais padrão (SCCs) para transferências internacionais de dados;
- contratos de processamento de dados disponíveis sob solicitação.

### Minimização de dados
- O CloudCDN não define cookies.
- Sem rastreamento de usuários ou pixels de análise.
- Nenhum dado pessoal é coletado, armazenado ou processado.
- Logs de acesso HTTP são gerenciados pela Cloudflare conforme sua política de privacidade.

### Direitos dos titulares dos dados
Como o CloudCDN não coleta dados pessoais, não há dados pessoais para acessar, corrigir ou excluir. Se você acredita que seus dados pessoais foram inadvertidamente incluídos em um ativo (por exemplo, uma foto), entre em contato com support@cloudcdn.pro para remoção.

### DPA (contrato de processamento de dados)
Clientes Enterprise podem solicitar um DPA formal. Entre em contato com sales@cloudcdn.pro.

## CCPA / CPRA (Califórnia)
O CloudCDN não vende, compartilha nem usa informações pessoais para publicidade direcionada. Nenhum mecanismo de opt-out é necessário, pois nenhum dado pessoal é coletado.

## SOC 2 / ISO 27001
O CloudCDN aproveita a infraestrutura da Cloudflare, que mantém:
- certificação SOC 2 Type II;
- certificação ISO 27001;
- conformidade PCI DSS Nível 1.
Essas certificações cobrem a infraestrutura de entrega de edge usada pelo CloudCDN.

## Medidas de segurança
- **Criptografia em trânsito:** TLS 1.3 em todas as conexões.
- **Proteção DDoS:** mitigação automática de DDoS da Cloudflare em todos os planos.
- **WAF:** o Web Application Firewall da Cloudflare está ativo em todos os endpoints.
- **Mitigação de bots:** o Cloudflare Bot Management protege contra scraping e abuso.
- **Commits assinados:** todas as alterações de ativos requerem verificação criptográfica.
- **Proteção de branches:** force pushes e reescritas de histórico são bloqueados.
- **Gerenciamento de segredos:** tokens de API armazenados como GitHub Secrets criptografados, nunca no código.

## Integridade dos ativos
Cada ativo entregue pelo CloudCDN é rastreável a um commit Git assinado. Isso fornece:
- **Procedência:** cada alteração de arquivo está vinculada a um contribuidor verificado.
- **Trilha de auditoria:** histórico Git completo com verificação de commits assinados.
- **Detecção de adulteração:** qualquer modificação não autorizada quebra a cadeia de assinaturas.

## Uso aceitável
O CloudCDN é exclusivamente para entrega de ativos estáticos. Usos proibidos incluem:
- Hospedar malware ou conteúdo de phishing.
- Streaming de vídeo ou distribuição de arquivos grandes (>25 MB).
- Armazenar dados pessoais, credenciais ou informações sensíveis em ativos.
- Usar o serviço para contornar os termos de outros serviços.

Violações resultam em suspensão da conta com aviso de 24 horas (exceto conteúdo ilegal, que é removido imediatamente).

## Resposta a incidentes
- Incidentes de segurança são reportados em até 72 horas conforme requisitos do GDPR.
- Entre em contato com security@cloudcdn.pro para reportar vulnerabilidades.
- Clientes Enterprise recebem notificação direta via seu canal Slack dedicado.

## Contato
- **Consultas de privacidade:** privacy@cloudcdn.pro
- **Reportes de segurança:** security@cloudcdn.pro
- **Solicitações de DPA:** sales@cloudcdn.pro
