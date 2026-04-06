# CloudCDN vs Cloudinary

## Em resumo

| Recurso | CloudCDN | Cloudinary |
|---------|----------|------------|
| **Preço inicial** | US$ 29/mês (Pro) | US$ 89/mês (Plus) |
| **Plano gratuito** | 10 GB/mês de banda | 25 créditos/mês (~5K transformações) |
| **Modelo de cobrança** | Banda (GB) | Baseado em créditos (complexo) |
| **Workflow** | Git-nativo (git push) | Upload por painel/SDK/API |
| **Otimização automática** | WebP + AVIF + JXL no push | Apenas em tempo real |
| **Recursos de IA** | Busca semântica + concierge RAG | Remoção de fundo por IA, preenchimento generativo |
| **Commits assinados** | Obrigatórios (integridade da supply chain) | Não aplicável |
| **Localizações de edge** | Mais de 300 (Cloudflare) | ~60 PoPs de CDN |
| **TTFB** | <50ms mediano (NA/UE) | ~80-120ms típico |
| **Domínios personalizados** | 5 (Pro), ilimitados (Enterprise) | Ilimitados (planos pagos) |
| **SLA** | 99,9% (Pro), 99,99% (Enterprise) | 99,9% (Business+) |
| **SSO/SAML** | Enterprise | Enterprise |
| **Servidor MCP** | Integrado (integração com agentes de IA) | Indisponível |
| **Procedência dos ativos** | Criptográfica (commits Git assinados) | Apenas timestamp de upload |

## Quando escolher o CloudCDN

- Você quer um **workflow Git-nativo** — sem painel, sem SDK, apenas `git push`
- Você precisa de **procedência criptográfica** para cada ativo (conformidade, trilha de auditoria)
- Você quer **cobrança simples por banda** (sem cálculo de créditos)
- Você entrega **ativos estáticos** (logos, ícones, banners, imagens) e quer TTFB abaixo de 50ms
- Você quer **busca de ativos com IA** e um **servidor MCP** para workflows guiados por agentes

## Quando escolher o Cloudinary

- Você precisa de **IA avançada para imagens** (remoção de fundo, preenchimento generativo, recorte automático)
- Você precisa de **transcodificação de vídeo** com streaming adaptativo
- Você precisa de **mais de 400 parâmetros de transformação** para pipelines de imagens complexos
- Você tem uma integração existente com Cloudinary usando SDKs

## Comparação de custos

Para um site que entrega 50 GB/mês de ativos estáticos:

- **CloudCDN Pro**: US$ 29/mês fixo
- **Cloudinary Plus**: US$ 89/mês + possível excedente de créditos

Para 200 GB/mês:

- **CloudCDN Pro**: US$ 29 + (100 GB excedentes × US$ 0,05) = US$ 34/mês
- **Cloudinary Advanced**: US$ 224/mês
