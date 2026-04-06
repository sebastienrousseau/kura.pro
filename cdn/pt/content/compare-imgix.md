# CloudCDN vs Imgix

## Em resumo

| Recurso | CloudCDN | Imgix |
|---------|----------|-------|
| **Preço inicial** | US$ 29/mês (Pro) | US$ 25/mês (Basic) |
| **Plano gratuito** | 10 GB/mês de banda | Nenhum |
| **Modelo de cobrança** | Banda (GB) | Imagens de origem + banda |
| **Workflow** | Git-nativo (git push) | Painel/API/SDK |
| **Otimização automática** | WebP + AVIF + JXL no push | Apenas em tempo real |
| **Parâmetros de transformação** | 9 (resize, format, blur, sharpen, gravity, fit, quality) | Mais de 400 |
| **Recursos de IA** | Busca semântica + concierge RAG + servidor MCP | Detecção de rostos, recorte automático |
| **Commits assinados** | Obrigatórios (integridade da supply chain) | Não aplicável |
| **Localizações de edge** | Mais de 300 (Cloudflare) | CDN Imgix (~50 PoPs) |
| **TTFB** | <50ms mediano (NA/UE) | ~60-100ms típico |
| **JPEG XL** | Suportado (gerado automaticamente no push) | Suportado |
| **Procedência dos ativos** | Criptográfica (commits Git assinados) | Nenhuma |
| **Servidor MCP** | Integrado | Indisponível |

## Quando escolher o CloudCDN

- Você quer um **plano gratuito** (o Imgix não tem)
- Você quer um **workflow Git-nativo** sem SDKs
- Você precisa de **procedência criptográfica de ativos** para conformidade
- Você entrega principalmente ativos estáticos de marca e não precisa de 400 parâmetros de transformação
- Você quer **integração com agentes de IA** via MCP

## Quando escolher o Imgix

- Você precisa de **mais de 400 parâmetros de transformação** para pipelines de imagens complexos
- Você precisa de **renderização em tempo real** de conteúdo enviado pelo usuário
- Você precisa de **purga por padrão de URL** (baseado em regex)
- Suas imagens estão armazenadas no S3/GCS e você precisa de um proxy de processamento

## Comparação de custos

Para um site com 500 imagens de origem e 50 GB/mês de entrega:

- **CloudCDN Pro**: US$ 29/mês
- **Imgix Basic**: US$ 25/mês + excedente de banda

Para mais de 1.000 imagens de origem:

- **CloudCDN Pro**: US$ 29/mês (imagens de origem ilimitadas)
- **Imgix Growth**: US$ 95/mês (1.500 imagens de origem incluídas)
