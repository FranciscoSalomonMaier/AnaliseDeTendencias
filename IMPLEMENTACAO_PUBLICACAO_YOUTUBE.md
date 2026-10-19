# Etapa 7 — Preparação para publicação no YouTube

## Uso local

1. Reinicie a API após atualizar o código e a configuração.
2. Abra Criação → **Acesso ao estúdio**.
3. Informe o valor de `CONTENT_ACCESS_KEY` de `api/.env`.
4. Abra um projeto e escolha **Publicação**, depois de Produção.
5. Selecione um render final, prepare os campos e thumbnails, salve e marque como pronto.

A chave foi configurada no arquivo local ignorado pelo Git, sem ser exibida no chat. `CONTENT_OWNER_ID` identifica o proprietário local. Nenhuma chave deve ser colocada em variáveis `VITE_*`, commits ou prompts.

A migration 011 foi aplicada pelo runner existente. Em outra instalação: `cd api && npm run migrate:publication`. O runner preserva dados e associa registros ainda sem proprietário ao proprietário local quando o acesso por chave está habilitado.

Use o mesmo host no frontend e na API para os cookies locais: a configuração atual usa `localhost:5173` e `localhost:3000`. `FRONTEND_URL` deve corresponder à origem do frontend. Em produção o cookie exige HTTPS.

## Diagnóstico e reutilização

O projeto utiliza NestJS, SQL com `pg`, Zod e React, sem ORM. Já havia providers de texto/imagens, assets locais, Sharp, fila de imagens e renderizações versionadas. Não havia uma preparação persistente para publicação nem autenticação de usuários.

Foram reutilizados:

- `ContentProjectRepository`, roteiro, ideia e cenas existentes.
- `LlmProvider` e o modelo retornado por `AiAnalysisService.getModel()`.
- `ImageProvider` e `ImageGenerationQueue`, com a configuração de imagem existente.
- `ContentAssetRepository` e `StorageProvider` para arquivos imutáveis.
- `RenderRepository` e `VideoRenderService.media()` para validar e reproduzir o render.
- Padrões de controllers, revisões, migrations e estilos da interface.

Não existe novo provider de IA, novo renderer, OAuth ou publicação automática.

## Arquitetura

`ContentAssetsModule` registra o módulo funcional de preparação:

```text
PublicationPreparation (React)
    → PublicationController
        → PublicationService
            → PublicationRepository
            → LlmProvider
            → PublicationThumbnailService
                → ImageGenerationQueue / ImageProvider
                → Sharp
                → ContentAssetRepository / StorageProvider
```

`ContentAccessGuard` protege os projetos quando o acesso local está configurado. `ContentAccessController` cria a sessão local.

## Modelo e migration

`011_content_publication.sql` adiciona:

- `owner_id` em `content_generation_runs`.
- `content_publication`: uma preparação YouTube por projeto, conteúdo JSONB, revisão e datas.
- `content_publication_generations`: histórico de operações de IA, estado, resultado, provider, modelo, uso de tokens e erro seguro.
- `content_publication_thumbnails`: alternativas e versões, asset final, fundo original privado e configuração tipográfica.

O JSON usa schema Zod e contém título principal, versões de títulos, descrição, tags, hashtags, capítulos, idioma, estilos, texto da thumbnail, thumbnail principal, render selecionado, referências das revisões e status DRAFT/READY.

Colunas geradas a partir do JSON permitem constraints compostas de render e thumbnail pelo mesmo projeto. As thumbnails também referenciam assets do próprio projeto. Não há migração ou reescrita dos snapshots históricos de vídeo. Exclusões são restringidas pelas relações, sem cascatas destrutivas.

Novos projetos recebem o proprietário configurado. Listagens com acesso habilitado omitem projetos de outros proprietários. Preparações ainda inexistentes recebem defaults sem gerar conteúdo ou consumir IA.

## Títulos, descrição, tags e hashtags

- Cada geração de títulos produz cinco sugestões distintas, até 100 caracteres e sem `<`/`>`.
- Estilos: automático, mistério, curiosidade, direto, narrativa e SEO. Idioma configurável, por padrão pt-BR.
- Sugestões são acrescentadas às versões existentes. A seleção principal não é substituída automaticamente.
- O usuário pode criar e editar títulos manualmente.
- A descrição e as listas sugeridas só entram no rascunho após confirmação no frontend. O conteúdo aprovado no servidor permanece intacto até salvar.
- Tags e hashtags são normalizadas e deduplicadas separadamente. Ambas são opcionais.
- A descrição final combina texto, capítulos habilitados e hashtags ainda ausentes, sem duplicar hashtags apenas porque estão seguidas de pontuação.
- O limite da descrição final considera bytes UTF-8, incluindo capítulos e hashtags. As tags consideram separadores e aspas aplicáveis a termos com espaços.

O prompt exige fidelidade ao conteúdo, identificação de ficção quando pertinente, ausência de fontes/créditos/links inventados e rejeição de clickbait enganoso. A resposta passa por schema e validações adicionais; a IA não é tratada como fonte confiável de fatos.

Quando há um render selecionado, a narração é reconstruída pelos assets de áudio daquele snapshot, e o contexto visual usa os prompts dos assets de imagem daquela versão. Assim, alterações posteriores no roteiro não substituem silenciosamente o conteúdo de referência do vídeo antigo. Se não houver texto confiável da narração, a geração é recusada e a edição manual continua disponível.

A validação estrutural e os prompts reduzem erros; não comprovam semanticamente a veracidade do texto ou a qualidade editorial. A revisão humana continua necessária.

## Capítulos

A geração é determinística e gratuita, utilizando os inícios reais das cenas do render selecionado e trechos de sua narração. Não usa `estimatedDurationSeconds` nem inventa divisões em intervalos arbitrários.

As marcas são expressas em segundos inteiros e formatadas como `MM:SS` ou `HH:MM:SS` na descrição. O primeiro capítulo começa em zero, são exigidas pelo menos três entradas e cada capítulo, inclusive o último, deve durar pelo menos dez segundos.

Se as cenas não permitirem capítulos naturais válidos, o sistema orienta a manter o recurso desativado. Títulos e tempos podem ser editados, adicionados e removidos. Trocar o vídeo preserva os capítulos, mas exige revisão ou nova geração antes de READY quando o recurso está habilitado.

## Thumbnails e composição

- A geração utiliza o provider de imagens já configurado.
- Default de três alternativas; operação limitada a uma, duas ou três imagens.
- Os cinco estilos e as três variações de composição alteram o prompt enviado efetivamente ao provider.
- A IA gera o fundo sem letras; o texto é aplicado pelo Sharp.
- Saída JPEG 1280×720, sem distorção, com arquivo abaixo de 2 MB como política conservadora de exportação.
- Upload de JPEG/PNG estático até 10 MB, mínimo 640×360 e máximo 24 milhões de pixels. Formato real e dimensões são inspecionados; extensão/MIME enviados pelo navegador não bastam.
- Texto configurável: até 60 caracteres, topo/centro/base, fonte, cor, contorno e visibilidade.
- Texto é escapado antes da composição SVG. Contorno e fundo são contrastados conforme a cor escolhida. Textos que não caibam na área segura são recusados.
- A mesma imagem final processada aparece no preview e no download, inclusive em tamanho reduzido.
- Reaplicar texto cria outra alternativa a partir do fundo original, sem chamar IA e sem sobrescrever a anterior.

Cada versão registra asset, provider/modelo quando houver, prompt no backend, configuração, data e status. Prompts internos e caminhos do storage não são retornados pela API de preparação. Thumbnails de publicação são excluídas da listagem de imagens de cena, evitando seleção acidental na produção.

Os arquivos originais do vídeo e as alternativas anteriores não são alterados. Falhas parciais de um lote preservam as imagens concluídas e informam quais alternativas falharam.

## RenderJob, status e checklist

Somente renders finais COMPLETED, do próprio projeto e com arquivo disponível aparecem para seleção. Prévias animadas não são elegíveis.

A preparação guarda o render escolhido e referências para a revisão dos capítulos e metadados. Trocar o render não apaga títulos, descrições ou thumbnails. São apresentados avisos quando metadados ou capítulos foram revisados para outra versão ou o projeto mudou.

READY exige vídeo, título, descrição, thumbnail válida e campos dentro dos limites. Tags, hashtags e capítulos desativados são opcionais. A thumbnail é exigida pelo fluxo desta implementação.

O checklist é calculado a partir do banco e dos arquivos. Se um arquivo desaparecer depois de READY, a leitura informa pendências e status efetivo DRAFT, preservando o conteúdo armazenado. A futura publicação deve sempre revalidar o checklist no servidor.

## Interface e persistência

A etapa foi acrescentada depois de Produção sem reorganizar áudio, legendas ou renderização. Ela permite assistir ao render selecionado, editar todos os metadados, gerar sugestões, gerenciar thumbnails e salvar DRAFT/READY.

Estado permanente fica no PostgreSQL e no storage. Não há dependência de localStorage. Revisões próprias rejeitam salvamentos concorrentes. Alterações locais pendentes são sinalizadas e a navegação interna/fechamento pede confirmação antes de descartá-las.

## Endpoints

| Método | Rota relativa ao projeto | Finalidade |
|---|---|---|
| GET | `/publication` | Preparação, versões, renders válidos e checklist |
| PATCH | `/publication` | Salvar conteúdo com revisão |
| POST | `/publication/generate` | METADATA, TITLES, DESCRIPTION ou THUMBNAILS |
| POST | `/publication/chapters` | Gerar capítulos pela timeline real |
| POST | `/publication/validate` | Recalcular checklist |
| POST | `/publication/thumbnails/upload` | Enviar JPEG/PNG |
| POST | `/publication/thumbnails/:thumbnailId/compose` | Criar versão com texto |
| GET | `/publication/thumbnails/:thumbnailId/file` | Preview final protegido |
| GET | `/publication/thumbnails/:thumbnailId/download` | Download JPEG protegido |

Prefixo: `/content-projects/:projectId`. A seleção de título, render e thumbnail usa PATCH da preparação, sem rotas redundantes. `POST /content-access/session` autentica a chave local.

## Segurança e custos

A opção escolhida foi **uso local com chave e proprietário no servidor**. Não foi criado um sistema multiusuário completo.

- Sessão em cookie HttpOnly, SameSite=Lax e Secure em produção; chave também pode autenticar chamadas técnicas por Bearer.
- Comparação de credenciais com `timingSafeEqual` e limite de tentativas de entrada.
- Guard global nas rotas `/content-projects`, abrangendo arquivos de assets, áudio e vídeo, evitando desvio pelos endpoints existentes.
- IDs e relação com o proprietário são verificados antes das operações. Projetos de outro proprietário retornam acesso negado.
- Sem chave configurada, a publicação falha fechada; o fluxo local antigo é preservado até habilitar o acesso.
- Uploads têm limites de bytes, pixels, arquivos e campos. Caminhos e nomes internos são gerados no servidor.
- Nenhuma geração ao abrir a página; botão e confirmação explícitos nas ações pagas.
- Trava persistente impede operações de IA simultâneas no mesmo projeto, inclusive entre processos da API.
- Limite de cinco gerações por minuto por projeto e compartilhamento da fila de imagens existente.
- Chamadas de publicação desativam o retry do SDK por uma opção adicional no provider reutilizado; os outros módulos mantêm a política anterior. Sem retry pago automático nesta etapa. Operações abandonadas são marcadas como falhas após janela conservadora, sem nova chamada automática.
- Provider/modelo e uso retornado pelo provider são registrados; não há estimativa inventada de preço em dólares.

Para múltiplos usuários/organizações, será necessário integrar identidade, gestão de permissões e sessões próprias. OAuth do YouTube, envio e agendamento permanecem fora desta etapa.

## Validação executada

- Backend: build, TypeScript e lint.
- Suíte backend completa: 44 suítes / 353 testes aprovados, incluindo 20 testes de publicação.
- Frontend: lint, build, tipos de API e dez arquivos de testes aprovados.
- Integração real PostgreSQL/Nest HTTP/storage/Sharp com providers de texto e imagem simulados.
- Geração de um MP4 local de fixture com FFmpeg; nenhuma geração de IA real.
- Fluxo DRAFT → render → cinco títulos → descrição/tags → capítulos 0/20/40 → três thumbnails → seleção → READY → leitura persistida.
- Upload, recomposição sem IA, alternativas imutáveis, resposta inválida, requisições simultâneas, arquivo ausente, revisão desatualizada e rejeição de projeto/render estrangeiro.
- Browser Chrome: sessão, etapa Publicação, edição e salvamento, reabertura, imagens reais processadas, READY, download e ausência de overflow em 1440/768/390 px.

Comandos específicos: `npm run test:publication` e `CONTENT_TEST_DATABASE_URL=... npm run test:publication:integration`, em `api`. O teste cria e remove seu próprio banco; use exclusivamente uma instância descartável. `PUBLICATION_SKIP_BROWSER=true` permite executar apenas a integração HTTP.

Evidências da última execução: `/tmp/trends-publication-CynrZf/thumbnail-final.jpg`, `/tmp/trends-publication-CynrZf/publication-ui.png` e `/tmp/trends-publication-CynrZf/evidence.json`. Artefatos são temporários e não entram no Git.

## Limitações e próximos passos

Nenhuma publicação foi realizada. Testes comprovam o pipeline com respostas simuladas, não a qualidade de títulos ou imagens de um provider real. A composição tipográfica é determinística, mas não constitui um editor gráfico. O modelo pode não manter identidade visual perfeita sem referências de imagem, que não foram adicionadas ao provider nesta etapa.

Os capítulos são extraídos de fronteiras reais de cenas; agrupamento semântico por IA não foi implementado. A autenticação atende ao uso local escolhido, não a um SaaS multiusuário. Sessões locais devem operar com frontend/API no mesmo site e HTTPS fora do desenvolvimento.

A próxima integração pode consumir a preparação validada, seu RenderJob e o arquivo final da thumbnail. Deve adicionar OAuth e publicação com confirmação explícita, revalidando disponibilidade, limites e permissões naquele momento.

## Fontes oficiais conferidas

- [YouTube Data API — vídeos, título, descrição e tags](https://developers.google.com/youtube/data/reference/rest/v3/videos).
- [YouTube — regras de capítulos](https://support.google.com/youtube/answer/9884579?hl=en-GB).
- [YouTube — thumbnails e limites por dispositivo](https://support.google.com/youtube/answer/72431?hl=en).
- [YouTube Data API — thumbnails](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set).
- [YouTube — hashtags](https://support.google.com/youtube/answer/6390658?hl=en).

A política local JPEG 1280×720 e abaixo de 2 MB é deliberadamente conservadora. A documentação atual admite resoluções maiores e limites diferentes no desktop/API; o sistema não apresenta 2 MB como limite universal atual do YouTube.
