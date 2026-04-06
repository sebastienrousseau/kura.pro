# CloudCDN — Limites e cotas

## Limites de arquivo
| Limite | Valor |
|--------|-------|
| Tamanho máximo de arquivo (entrega CDN) | 25 MB |
| Tamanho máximo de arquivo (repositório Git) | Sem limite rígido (GitHub LFS disponível) |
| Formatos de imagem suportados | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Formatos de vídeo suportados | MP4 (≤25 MB) |
| Comprimento máximo do nome do arquivo | 255 caracteres |
| Sensibilidade a maiúsculas/minúsculas em URLs | Sim — os caminhos diferenciam maiúsculas e minúsculas |

## Limites de banda
| Nível | Banda mensal | Excedente |
|-------|--------------|-----------|
| Free | 10 GB | O serviço é pausado até o próximo mês |
| Pro | 100 GB | US$ 0,05/GB |
| Enterprise | Ilimitado | N/A |

A banda é medida como bytes entregues do edge para usuários finais. Pulls de origem, transferências CI/CD e chamadas à API do Concierge não contam.

## Limites de deployment
| Limite | Valor |
|--------|-------|
| Máximo de arquivos por deployment | 20.000 |
| Tamanho máximo de deployment | Sem limite rígido (uploads incrementais) |
| Deployments simultâneos | 1 (em fila se sobrepostos) |
| Frequência de deploy | Sem limite (acionado a cada push para main) |

## Limites de transformação de imagens (Pro+)
| Limite | Pro | Enterprise |
|--------|-----|-----------|
| Transformações/mês | 50.000 | Ilimitadas |
| Dimensões máximas de saída | 8192 x 8192 px | 8192 x 8192 px |
| Parâmetro de qualidade máximo | 100 | 100 |
| Raio máximo de desfoque | 250 | 250 |
| Formatos de saída suportados | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## Limites de API e taxa
| Endpoint | Limite |
|----------|--------|
| Entrega de ativos | Ilimitado (edge Cloudflare) |
| manifest.json | Ilimitado (cache de edge de 5 min) |
| API de chat do Concierge | 1.000 consultas/mês (todos os níveis) |
| API de purga de cache (Pro+) | 1.000 purgas/dia |

## Domínios personalizados
| Nível | Domínios personalizados |
|-------|------------------------|
| Free | 0 |
| Pro | Até 5 |
| Enterprise | Ilimitados (incluindo wildcard) |

## Armazenamento
Não há cota de armazenamento — você pode enviar arquivos ilimitados para o repositório. O limite prático é dado pelas recomendações de tamanho de repositório do GitHub (idealmente abaixo de 5 GB, com GitHub LFS para repositórios maiores).

## Conversão automática
| Limite | Valor |
|--------|-------|
| Formatos gerados por upload | 2 (WebP + AVIF) |
| Conversões simultâneas máximas (CI) | Baseado no runner GitHub Actions (2 núcleos de CPU) |
| Timeout de conversão | 6 horas (limite do GitHub Actions) |

## Concierge de IA
| Limite | Valor |
|--------|-------|
| Consultas mensais | 1.000 |
| Consultas por sessão (lado do cliente) | 100 |
| Histórico de conversa | Apenas sessão atual (não persistido) |
| Tamanho da base de conhecimento | 5 documentos de conteúdo, ~30 chunks |
| Máximo de tokens de resposta | 512 |

## O que acontece quando os limites são atingidos
- **Banda excedida (Free):** os ativos param de ser servidos até o próximo mês. Aviso por e-mail aos 80%.
- **Banda excedida (Pro):** excedente cobrado a US$ 0,05/GB. Sem interrupção de serviço.
- **Limite do Concierge atingido:** o widget de chat é desativado pelo mês.
- **Limite de transformação atingido (Pro):** as transformações retornam o formato original até o próximo mês.
- **Arquivo muito grande:** arquivos >25 MB são excluídos do CDN, mas permanecem no Git.
