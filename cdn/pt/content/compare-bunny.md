# CloudCDN vs Bunny CDN

## Em resumo

| Recurso | CloudCDN | Bunny CDN |
|---------|----------|-----------|
| **Preço inicial** | US$ 29/mês (Pro) | US$ 9,50/mês fixo |
| **Plano gratuito** | 10 GB/mês de banda | Apenas teste de 14 dias |
| **Modelo de cobrança** | Faixas de banda | Por GB (preço por volume a partir de US$ 0,01/GB) |
| **Workflow** | Git-nativo (git push) | Painel/FTP/API |
| **Otimização automática** | WebP + AVIF + JXL no push | Bunny Optimizer (complemento separado) |
| **API de Storage** | Esquema JSON compatível com Bunny.net | Nativo |
| **Recursos de IA** | Busca semântica + concierge RAG + servidor MCP | Nenhum |
| **Commits assinados** | Obrigatórios (integridade da supply chain) | Não aplicável |
| **Localizações de edge** | Mais de 300 (Cloudflare) | 114 PoPs |
| **TTFB** | <50ms mediano (NA/UE) | ~40-80ms típico |
| **Edge compute** | Cloudflare Workers (runtime JS completo) | Bunny Script (limitado) |
| **Perma-Cache** | Cabeçalhos imutáveis de 1 ano | Recurso Perma-Cache |
| **JPEG XL** | Suportado | Indisponível no Optimizer |
| **Procedência dos ativos** | Criptográfica (commits Git assinados) | Nenhuma |
| **Servidor MCP** | Integrado | Indisponível |

## Por que o CloudCDN usa APIs compatíveis com o Bunny

A API de Storage do CloudCDN retorna um esquema JSON compatível com Bunny.net (Guid, StorageZoneName, Path, ObjectName, etc.). Isso significa que ferramentas de migração e scripts criados para o Bunny funcionam com o CloudCDN imediatamente.

## Quando escolher o CloudCDN

- Você quer um **workflow Git-nativo** (sem FTP, sem uploads pelo painel)
- Você precisa de **busca com IA** e **integração com agentes** (MCP)
- Você precisa de **procedência criptográfica** para cada ativo
- Você quer geração automática de **JPEG XL** junto com WebP e AVIF
- Você quer um **plano gratuito permanente** (o teste do Bunny expira)

## Quando escolher o Bunny CDN

- Você precisa do **menor preço por GB possível** (US$ 0,01/GB em algumas regiões)
- Você precisa de **acesso FTP/SFTP** ao seu storage
- Você precisa do **Bunny Stream** para hospedagem de vídeo
- Você tem banda muito alta (mais de 100 TB/mês) e precisa de descontos por volume
- Você precisa de **proteção DDoS** como complemento com regras personalizadas

## Comparação de custos

Para um site que entrega 50 GB/mês:

- **CloudCDN Pro**: US$ 29/mês
- **Bunny CDN**: ~US$ 2,50/mês (UE/EUA a US$ 0,05/GB) + US$ 0,50/mês de storage

Para 500 GB/mês:

- **CloudCDN Pro**: US$ 29 + (400 GB × US$ 0,05) = US$ 49/mês
- **Bunny CDN**: ~US$ 25/mês (UE/EUA) + storage

O Bunny vence em custo bruto de banda. O CloudCDN vence em workflow, recursos de IA, procedência e plano gratuito.
