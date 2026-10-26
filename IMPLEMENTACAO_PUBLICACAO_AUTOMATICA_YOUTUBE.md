# Etapa 9 — Publicação oficial no YouTube

Implementação de 25/10/2026. Guia operacional: [docs/youtube-integration.md](docs/youtube-integration.md).

## Diagnóstico inicial e arquitetura

O repositório já continha a pipeline de produção, RenderJobs com snapshots e assets imutáveis, storage com leitura por intervalo, preparação de publicação com revisões, destinos tradicional/Shorts/Reels e controle local por chave/proprietário. A integração `sources/youtube` existente consultava tendências com API key, sem OAuth, canais autorizados ou uploads.

Foi adicionada a integração `api/src/youtube-publishing`, registrada no módulo de assets existente para reutilizar seus serviços. Não foi criado novo renderizador, provider de imagens, serviço de metadados ou broker de filas. A fila de upload segue o padrão persistente PostgreSQL/advisory locks já utilizado pelo projeto, com worker de liderança e concorrência um.

O uso permanece local, com `CONTENT_ACCESS_KEY` e `CONTENT_OWNER_ID`. Não se apresenta esse mecanismo como login SaaS multiusuário. Projetos, canais, jobs e regras são filtrados pelo proprietário; referências compostas reforçam os vínculos no banco.

## Modelos, migration e arquivos

`013_youtube_publishing.sql` acrescenta conexões de canais, estados OAuth, publicações, eventos e regras. Não modifica vídeos ou preparações anteriores. O snapshot do envio preserva título, descrição composta, tags, idioma, capa, arquivo, dimensões/FPS/duração, canal e opções de conteúdo/privacidade/agendamento.

A chave de idempotência é única por proprietário. Um índice impede outro upload ativo/possivelmente recebido para o mesmo canal e RenderJob, mesmo se o destino alternar entre tradicional e Shorts. Somente um cancelamento anterior a qualquer início libera criação de rascunho revisado, preservando o registro cancelado.

| Área | Arquivos |
| --- | --- |
| Configuração/criptografia | `youtube-settings.ts`, `youtube-crypto.ts`, `api/.env.example` |
| HTTP oficial e OAuth | `youtube-http.ts`, `youtube-oauth.service.ts` |
| Domínio/persistência | `youtube.schema.ts`, `youtube.repository.ts`, migration 013 |
| Validação e execução | `youtube-publication.service.ts`, `youtube-upload.service.ts`, `youtube-publication.worker.ts` |
| API/registro | `youtube-publishing.controller.ts`, `content-assets.module.ts`, `content-publication/content-access.ts` |
| Interface | `frontend/src/pages/YoutubeIntegration/` — integrações, preparação de envio e histórico |
| Navegação/contratos | `App.jsx`, `layouts/Aside/Aside.jsx`, `PublicationPreparation.jsx`, `youtubePublishingService.js`, `utils/youtubePublication.js`, `types/youtubePublishing.d.ts` |
| Testes | `youtube-publishing.spec.ts`, `youtube-publishing.fixture.cjs`, `youtube-publishing.integration.cjs`, integração/browser de publicação, `frontend/test/youtubePublishing.test.mjs` |
| Scripts/docs | `scripts/migrate-assets.cjs`, `api/package.json`, guia de integração e este relatório |

## OAuth, credenciais e canais

O fluxo web utiliza state aleatório de uso único, TTL, navegador autenticado, cookie HttpOnly e PKCE. Tokens e verificadores persistidos são cifrados com AES-256-GCM/AAD. A chave fica fora do banco e o formato inclui ID para rotação, com suporte a chaves anteriores. Não há tokens em respostas de histórico, URLs do frontend ou eventos.

São solicitados somente `youtube.upload` e `youtube.readonly`. O Google identifica o canal autorizado. Refresh tokens anteriores são preservados quando omitidos na resposta; renovação usa lock por conexão. `invalid_grant` marca a conexão como expirada. Desconexão tenta revogar no Google, remove as credenciais locais, desativa regras e sinaliza jobs, preservando histórico. Falhas de revogação remota são informadas.

Credenciais Google e criptografia não foram inventadas nem preenchidas em `api/.env`. As flags de upload e publicação não privada são falsas por padrão.

## Upload, idempotência e recuperação

A publicação nasce como DRAFT e precisa de confirmação para entrar na fila. A validação reutiliza READY/revisão, checklist, metadados compostos, RenderJob final, arquivo existente, cabeçalho MP4 e informações H.264/AAC da renderização validada. Não gera mídia ou metadados.

O worker envia intervalos de até 8 MiB por streaming. Persiste a intenção antes do POST inicial, cifra a sessão e registra somente bytes confirmados. Retomadas consultam a sessão via PUT vazio; 308 orienta o próximo offset. A perda da resposta final é recuperada pela mesma sessão, sem novo `videos.insert`.

Sem resultado conclusivo ou com sessão expirada, utiliza NEEDS_ATTENTION. A reconciliação explícita pode vincular um videoId existente do canal autorizado. Recusas HTTP definitivas do POST que não aceitaram arquivo permitem nova tentativa explicitamente solicitada; falhas de rede/5xx ambíguas nunca liberam outro POST automaticamente.

Retries seguros têm backoff, limite e respeito a Retry-After. Falhas de cota/permissão não são repetidas automaticamente. O worker usa locks reais e não roda dentro da requisição HTTP. Um restart recupera sessão persistida, em vez de declarar falha e começar outro envio.

## Progresso, processamento e capas

Upload recebido é PROCESSING, nunca PUBLISHED por presunção. `videos.list` confirma processamento, privado, não listado, agendado, público, remoção/indisponibilidade e falha. O link tem ID validado e pode corresponder a conteúdo privado. O histórico permite filtrar canal/status e consultar eventos.

A thumbnail tradicional usa o JPEG selecionado e `thumbnails.set`. Falhas são parciais; repetir thumbnail não reenvia MP4. Shorts usam o mesmo upload oficial, com saída vertical e até 180 segundos. A aplicação não garante classificação e deixa a capa de Shorts para o Studio, conforme a documentação atual.

## Privacidade, conformidade e agenda

Privado é o padrão; as declarações de conteúdo infantil e mídia sintética exigem resposta humana. Categoria, licença e idioma são preservados. A confirmação mostra o canal, o título e as opções reais do snapshot que será enviado.

Agendamento utiliza `publishAt` privado, instante UTC e fuso salvo, com data futura. O upload começa após a confirmação; não foi implementado um segundo tipo de agenda para adiar o próprio upload. Datas ultrapassadas são bloqueadas. Só se marca SCHEDULED/PUBLISHED com resposta correspondente da API.

Cancelar localmente não exclui vídeo nem altera o agendamento remoto. Edições posteriores de privacidade, agendamento ou exclusão são feitas no Studio; não se pediram escopos amplos de edição para oferecer controles que não teriam permissão.

## Automação, observabilidade e desempenho

As regras são ausentes/desativadas por padrão, vinculadas a projeto/canal/destino e confirmação explícita. Podem criar rascunho, enviar privado ou enviar e programar após um atraso configurado. Exigem READY, RenderJob selecionado e declarações persistidas; contam o histórico contra o limite de 1–10 registros. Não regeneram assets nem aprovam vídeos automaticamente. Desativação e desconexão são suportadas.

Eventos registram operações/resultados/códigos, sem tokens, URLs sensíveis ou corpos privados. A tela de integrações exibe contagens das últimas 24 horas e acesso ao painel de cotas Google. Não foi fixado um antigo custo por upload nem prometido uso ilimitado.

O código mantém um upload concorrente por banco, timeout limitado, streaming e polling controlado. Não copia o MP4 para novo storage nem aumenta recursos do renderizador. Os testes usam vídeos pequenos e não constituem benchmark de arquivos longos ou redes lentas.

## Endpoints

Prefixo independente da consulta de tendências: `/youtube-publishing`.

- `GET configuration`, `GET operations`.
- `POST oauth/authorize`, `GET oauth/callback`.
- `POST channels/:id/verify`, `DELETE channels/:id`.
- `POST publications/validate`, `POST publications`, `GET publications`, `GET publications/:id`.
- `POST publications/:id/upload|retry|cancel|status`.
- `POST publications/:id/thumbnail/retry`.
- `GET/PATCH automation/:projectId`.

Mutações exigem autenticação, origem permitida quando enviada pelo navegador, validação de payload e confirmação. A consulta remota manual é POST; GETs de configuração/histórico não enviam arquivos nem fazem polling remoto como efeito colateral.

## Testes e pendências externas

Validações efetivamente executadas:

- Backend: `npm run build`, `tsc --noEmit` e lint dos arquivos alterados passaram.
- Suíte Jest completa: **46 suítes / 412 testes passaram**, incluindo **39 testes novos** de publicação. As verificações direcionadas também passaram após o ajuste de compatibilidade com produção sem OAuth configurado.
- Frontend: build Vite, lint e **75 testes passaram**; contratos TypeScript verificados. O teste direcionado da integração também passou após a correção visual.
- PostgreSQL/Nest/HTTP: migration 013 aplicada duas vezes no banco descartável, autenticação/origem/proprietário, state/PKCE/expiração/negação/replay, criptografia/renovação, streaming em partes/308, perda da resposta final, concorrência/idempotência, privacidade e agendamento, reconciliação, falha parcial de thumbnail, cancelamento, sessão expirada, cotas, invalid_grant, automação explícita sem loop e revogação passaram.
- Foram utilizados MP4s locais reais: horizontal 320×180 com 60 segundos e vertical 180×320 com dois segundos. O destino Shorts foi enviado somente ao simulador, preservando a separação de capa manual.
- Chrome: sessão local, preparação existente, imagens, edição/salvamento/reabertura, READY, download, canal/histórico, confirmação com canal/título/privacidade, desconexão, erro de autorização e layout em **1440/768/390 px** passaram. A captura final foi inspecionada e o contraste do fundo escuro foi verificado.
- `git diff --check` passou.

Evidências finais: `/tmp/trends-publication-UHcjxX/youtube-publishing-evidence.json`, `/tmp/trends-publication-UHcjxX/youtube-integration-ui.png` e `/tmp/trends-publication-UHcjxX/publication-ui.png`. O simulador registrou cinco sessões e dez trechos de arquivo, além de renovação e revogação. Esses números são operações locais simuladas, sem consumo de cota Google.

A migration foi aplicada **com sucesso no banco configurado em `api/.env`**, pelo runner compartilhado. O container descartável de testes é separado do banco de desenvolvimento.

Verificação de configuração sem exibir segredos: OAuth e chave de criptografia ainda não estão configurados em `api/.env`; uploads e envio não privado continuam desabilitados. Nenhuma conta real foi conectada, nenhum upload chegou ao Google e nenhuma geração paga foi executada.

Para uso real, ainda são necessárias credenciais próprias do Google Cloud, consentimento e eventuais verificações/cotas da conta. O procedimento opcional privado está no guia e não foi executado sem autorização. A chave de criptografia precisa ser preservada com segurança fora do Git.

Fontes oficiais e instruções detalhadas de configuração, manutenção, testes e solução de erros: [guia de integração](docs/youtube-integration.md).
