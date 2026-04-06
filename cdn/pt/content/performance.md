# CloudCDN — Desempenho

## Rede de edge
O CloudCDN é construído sobre a rede global da Cloudflare:
- **Mais de 300 data centers** em mais de 100 países e mais de 193 cidades.
- **95% da população mundial** está a menos de 50ms de um PoP da Cloudflare.
- **Mais de 8.000 interconexões de rede** para roteamento ideal.
- O roteamento anycast direciona automaticamente as requisições para o PoP mais próximo.

## Latência
| Região | TTFB mediano (cache hit) | TTFB P95 |
|--------|--------------------------|----------|
| América do Norte | <30ms | <80ms |
| Europa | <35ms | <90ms |
| Ásia Pacífico | <50ms | <120ms |
| América do Sul | <60ms | <150ms |
| África | <80ms | <200ms |

Estes são os tempos de hit do cache de edge. A primeira requisição a um PoP requer fetch de origem (adiciona 50-200ms uma vez).

## Estratégia de cache
Todos os ativos usam cache imutável agressivo:
```
Cache-Control: public, max-age=31536000, immutable
```

Isso significa:
- **Cache do navegador:** 1 ano. Sem requisições de revalidação.
- **Cache de edge do CDN:** 1 ano. Servido do PoP mais próximo.
- **Taxa de hit do cache:** >95% para ativos de produção.
- **Cache-busting:** mude o nome/caminho do arquivo para servir ativos atualizados.

O manifest.json usa cache de curta duração:
```
Cache-Control: public, max-age=300
```

## Compressão de imagens

### Comparação de formatos
| Formato | Tamanho típico (vs PNG) | Suporte do navegador | Caso de uso |
|---------|-------------------------|---------------------|-------------|
| PNG | Referência (100%) | 100% | Sem perdas, transparência |
| WebP | ~40% do PNG | 97% | Entrega web geral |
| AVIF | ~30% do PNG | 93% | Compressão máxima |
| SVG | Varia | 100% | Gráficos vetoriais, ícones |

### Configurações de conversão automática
- **WebP:** qualidade 80, com perdas. Melhor equilíbrio entre qualidade e tamanho.
- **AVIF:** qualidade 65, com perdas. Compressão máxima com boa fidelidade visual.
- Os originais (PNG/JPEG) são sempre preservados ao lado das variantes geradas.

### Economia no mundo real
Para um projeto típico com 50 ícones (16x16 a 512x512):
- Total PNG: ~5 MB
- Total WebP: ~2 MB (redução de 60%)
- Total AVIF: ~1,5 MB (redução de 70%)

Para imagens de banner (1200x630):
- PNG: ~500 KB em média
- WebP: ~150 KB em média
- AVIF: ~90 KB em média

## Impacto nos Core Web Vitals
Servir imagens otimizadas via CloudCDN melhora diretamente:

### LCP (Largest Contentful Paint)
- Meta: <2,5 segundos.
- Impacto: servir AVIF em vez de PNG pode reduzir o LCP em 40-60% para páginas com muitas imagens.
- Dica: pré-carregue imagens above-the-fold com `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Meta: <0,1.
- Impacto: sempre defina os atributos `width` e `height` em tags `<img>` para reservar espaço.
- Dica: use o campo `size` do manifest.json para cálculos de layout responsivo.

### INP (Interaction to Next Paint)
- Meta: <200ms.
- Impacto: imagens menores significam menos trabalho de decodificação no thread principal.
- Dica: use `loading="lazy"` em imagens below-the-fold para reduzir o peso inicial da página.

## Desempenho de deploy
| Métrica | Valor |
|---------|-------|
| Deploy incremental (1-10 arquivos alterados) | 5-15 segundos |
| Deploy completo (mais de 10.000 arquivos) | 30-60 segundos |
| Compressão de imagem (por PNG, CI) | ~200ms |
| Geração de manifest (mais de 10.000 ativos) | <5 segundos |

Os deploys usam deduplicação por content-hash — apenas arquivos novos ou alterados são enviados. Após o deploy inicial, pushes subsequentes normalmente enviam apenas os arquivos alterados.

## Monitoramento
- **Cloudflare Analytics:** disponível no painel da Cloudflare → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions:** logs de build e deploy disponíveis na aba Actions.
- **Status:** a homepage (cloudcdn.pro) exibe o status operacional.

## Dicas de otimização
1. **Use URLs AVIF** sempre que possível — são 70% menores que PNG.
2. **Use o elemento `<picture>`** para fallback de formato (AVIF → WebP → PNG).
3. **Pré-carregue imagens críticas** above-the-fold.
4. **Faça lazy-load de tudo below-the-fold** com `loading="lazy"`.
5. **Defina dimensões explícitas** em todas as tags `<img>` para prevenir layout shift.
6. **Use o menor tamanho de ícone necessário** — não sirva 512x512 quando 64x64 é suficiente.
7. **Nível Pro:** use `?format=auto` para deixar o CloudCDN servir o formato ideal automaticamente.
