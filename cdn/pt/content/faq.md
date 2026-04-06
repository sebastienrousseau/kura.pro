# CloudCDN — Perguntas frequentes

## Primeiros passos

### O que é o CloudCDN?
CloudCDN é um CDN de imagens Git-nativo. Envie imagens para um repositório GitHub e elas são automaticamente otimizadas (WebP + AVIF) e servidas globalmente a partir das mais de 300 localizações de edge da Cloudflare com latência inferior a 100ms.

### Como o CloudCDN se diferencia do Cloudinary ou Imgix?
O CloudCDN usa um workflow Git-nativo — sem uploads pelo painel, sem SDKs, sem sistemas de créditos. Você faz `git push` e seus ativos estão online. O Cloudinary usa cobrança baseada em créditos a partir de US$ 89/mês para planos pagos. O Imgix usa pacotes de créditos a partir de US$ 25/mês. O nível Pro do CloudCDN é US$ 29/mês com cobrança simples por banda.

### O CloudCDN é gratuito para projetos open-source?
Sim. O nível gratuito é permanentemente gratuito com 10 GB/mês de banda. Sem cartão de crédito, sem expiração de teste. Ideal para logos, banners, ícones e ativos de documentação de projetos OSS.

### Preciso instalar alguma coisa?
Não. Você só precisa de Git (2.34+) e uma chave SSH para commits assinados. Sem Node.js, sem gerenciadores de pacotes, sem ferramentas de build. O pipeline CI/CD lida com toda a otimização de imagens no lado do servidor.

## Formatos de arquivo

### Quais formatos de arquivo são suportados?
Upload: PNG, JPEG, SVG, ICO, WebP. O pipeline gera automaticamente variantes WebP e AVIF para todos os uploads PNG e JPEG. Arquivos SVG e ICO são servidos como estão.

### Quais configurações de qualidade são usadas para conversão automática?
WebP: qualidade 80 (quase sem perdas, ~60% menor que PNG). AVIF: qualidade 65 (alta eficiência, ~70% menor que PNG). Estas são otimizadas para o melhor equilíbrio entre qualidade visual e tamanho de arquivo.

### Posso substituir as configurações de qualidade?
No nível Pro, a API de Transformação de Imagens suporta qualidade personalizada via parâmetros de URL: `?q=90` para qualidade superior, `?q=50` para mais compressão. O nível gratuito usa as configurações padrão.

### E o JPEG XL?
Em 2026, o JPEG XL está atrás de uma flag no Chrome e Firefox, com suporte parcial no Safari. Adicionaremos a conversão automática para JPEG XL quando o suporte do navegador atingir mais de 80%. Atualmente, o AVIF oferece melhor compressão com compatibilidade mais ampla (mais de 93% de suporte de navegador).

### Qual é o tamanho máximo de arquivo?
25 MB por arquivo para entrega via CDN. Arquivos com mais de 25 MB permanecem no repositório Git, mas são excluídos do deployment de edge. Para referência, um PNG 4K de alta qualidade tem normalmente 5-15 MB.

## Desempenho

### Quão rápida é a entrega de ativos?
TTFB mediano abaixo de 50ms na América do Norte e Europa, abaixo de 100ms globalmente. Os ativos são servidos com cabeçalhos de cache imutáveis (max-age de 1 ano), portanto, visitas repetidas são servidas diretamente do cache do navegador.

### Como funciona o cache?
Todos os ativos são servidos com `Cache-Control: public, max-age=31536000, immutable`. Navegadores e edges de CDN cacheiam arquivos por um ano. Para atualizar um ativo, mude o nome do arquivo (por exemplo, `logo-v2.webp`) — esta é a abordagem padrão de cache-busting.

### Qual é a taxa de hit do cache?
Ativos em produção normalmente veem uma taxa de hit de cache acima de 95%. O arquivo manifest.json é cacheado por 5 minutos para se manter atualizado. O painel nunca é cacheado.

### Posso purgar o cache manualmente?
Nível gratuito: as purgas de cache acontecem automaticamente no deploy. Pro/Enterprise: você pode purgar URLs específicas ou padrões wildcard via painel da Cloudflare ou API.

## API de Transformação de Imagens (Pro+)

### Como funciona a API de transformação?
Adicione parâmetros de URL a qualquer URL de ativo:
```
https://cloudcdn.pro/projeto/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### Quais parâmetros estão disponíveis?
- `w` — Largura em pixels (por exemplo, `?w=400`)
- `h` — Altura em pixels (por exemplo, `?h=300`)
- `fit` — Modo de redimensionamento: `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Formato de saída: `auto` (melhor para o navegador), `webp`, `avif`, `png`, `jpeg`
- `q` — Qualidade: 1-100 (padrão varia por formato)
- `blur` — Desfoque gaussiano: 1-250 (por exemplo, `?blur=20` para placeholder LQIP)
- `sharpen` — Nitidez: 1-10
- `gravity` — Ponto de ancoragem do recorte: `center`, `north`, `south`, `east`, `west`, `face` (IA)

### O CloudCDN suporta negociação automática de formato?
Sim (Pro+). Quando você usa `?format=auto`, o CloudCDN lê o cabeçalho `Accept` do navegador e serve AVIF (se suportado), depois WebP, depois o formato original. Isso garante que cada visitante receba o menor arquivo possível.

## Configuração e workflow

### Como faço upload de ativos?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
Em 1-2 minutos, seu ativo estará online em `https://cloudcdn.pro/my-project/images/logos/my-logo.webp`.

### Posso usar um domínio personalizado?
Os níveis Pro e Enterprise suportam domínios personalizados. Domínios personalizados recebem provisionamento SSL automático e configuração CNAME via Cloudflare DNS. Entre em contato com support@cloudcdn.pro para configurar.

### Funciona em macOS, Linux e WSL2?
Sim. Todas as plataformas com Git e SSH. Veja o Guia de Configuração para instruções específicas da plataforma, incluindo geração de chave SSH e configuração de assinatura Git.

## Segurança

### Os commits assinados são obrigatórios?
Sim. Todos os pushes para o branch main exigem commits assinados (SSH Ed25519 ou GPG). Isso garante que cada alteração de ativo seja verificada criptograficamente. Veja o Guia de Segurança para configuração.

### Meus dados estão seguros?
Os ativos são servidos via HTTPS com TLS 1.3. O repositório de origem está no GitHub com proteção de branch. A Cloudflare fornece proteção DDoS, WAF e mitigação de bots em todos os planos.

## Cobrança

### Como funciona a cobrança por banda?
Gratuito: 10 GB/mês. Pro: 100 GB/mês incluídos, US$ 0,05/GB de excedente. Enterprise: ilimitado. Banda = total de bytes entregues do edge para usuários finais. Pulls de origem e transferências CI/CD não contam.

### Posso fazer upgrade ou downgrade a qualquer momento?
Sim. Upgrades têm efeito imediato (proporcionais). Downgrades têm efeito no próximo ciclo de cobrança. Cancele a qualquer momento — sem contratos.

### Existe um teste gratuito do Pro?
Sim. 14 dias de acesso completo. Sem cartão de crédito necessário. Reverte automaticamente para o nível gratuito se você não assinar.

### O que acontece se eu exceder a banda do nível gratuito?
Os ativos param de ser servidos pelo CDN pelo restante do mês. Eles permanecem no repositório Git e voltam a ser servidos no início do próximo mês. Você receberá um aviso por e-mail aos 80% de uso.

## Conformidade

### O CloudCDN está em conformidade com o GDPR?
Sim. O CloudCDN usa a infraestrutura da Cloudflare, que processa dados de acordo com o GDPR. Oferecemos um Contrato de Processamento de Dados (DPA) para clientes Enterprise. Nenhum dado pessoal de usuário é armazenado — entregamos apenas arquivos estáticos.

### Onde os dados são armazenados?
Os arquivos de ativos são armazenados no repositório GitHub (EUA) e cacheados nas mais de 300 localizações de edge globais da Cloudflare. As cópias em cache expiram após 1 ano ou em um novo deployment.
