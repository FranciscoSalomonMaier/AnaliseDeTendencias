# Integração oficial com o YouTube — configuração e operação

Etapa 9, implementada em 25/10/2026. A integração utiliza endpoints oficiais da YouTube Data API v3 e OAuth do Google. A integração de consulta de tendências em `sources/youtube` continua independente.

## Preparar o ambiente

1. Inicie o PostgreSQL utilizado pelo projeto. Com o Compose atual, execute `docker compose up -d postgres` na raiz.
2. Em `api`, execute `npm run migrate:youtube-publishing`. O runner inclui as migrations anteriores e `013_youtube_publishing.sql`. Não aplique apenas trechos isolados do SQL.
3. Configure as variáveis abaixo em `api/.env`. Mantenha esse arquivo fora do Git. `.env.example` contém somente placeholders.

```dotenv
CONTENT_ACCESS_KEY=<chave local já utilizada pelo estúdio>
CONTENT_OWNER_ID=local-owner
FRONTEND_URL=http://localhost:5173
YOUTUBE_CLIENT_ID=<cliente OAuth do Google>
YOUTUBE_CLIENT_SECRET=<segredo do cliente OAuth>
YOUTUBE_REDIRECT_URI=http://localhost:3000/youtube-publishing/oauth/callback
YOUTUBE_ENCRYPTION_KEY=<32 bytes aleatórios em base64>
YOUTUBE_ENCRYPTION_KEY_ID=v1
YOUTUBE_PREVIOUS_ENCRYPTION_KEYS=
YOUTUBE_UPLOADS_ENABLED=false
YOUTUBE_PUBLIC_PUBLICATION_ENABLED=false
```

A chave de criptografia é da aplicação, independente de `CONTENT_ACCESS_KEY`, da chave da OpenAI e das credenciais Google. Para gerar seu valor localmente, execute e copie o resultado somente para seu `.env`/gerenciador de segredos:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Não envie esse valor em screenshots, commits ou logs. A implementação não inventa nem preenche client IDs ou segredos Google.

`YOUTUBE_UPLOADS_ENABLED=false` impede uploads de MP4 e thumbnails. A criação de rascunhos e a conexão OAuth são ações separadas. `YOUTUBE_PUBLIC_PUBLICATION_ENABLED=false` bloqueia envio público, não listado e agendamento. O padrão de privacidade do formulário é privado; as declarações de conteúdo não têm resposta automática.

Reinicie a API após mudar o ambiente. Em produção, use HTTPS tanto no frontend quanto no callback; cookies sensíveis usam `Secure`. Utilize `localhost` nos dois lados em desenvolvimento, evitando misturar `localhost` com `127.0.0.1`.

## Configurar o Google Cloud

1. Crie ou selecione um projeto no Google Cloud Console.
2. Habilite **YouTube Data API v3** em APIs e serviços.
3. Configure a tela de consentimento no Google Auth Platform: nome do aplicativo, contato de suporte, público e informações de privacidade pertinentes ao seu uso.
4. Para desenvolvimento, configure os usuários de teste e utilize uma conta/canal de teste. A disponibilidade do consentimento e a validade das autorizações dependem do estado do aplicativo e das políticas Google.
5. Crie um cliente OAuth do tipo **Web application**. Cadastre exatamente a URI de retorno informada no ambiente, incluindo porta e caminho. A URI pertence à API, não ao Vite.
6. Configure estes escopos:

| Escopo | Finalidade |
| --- | --- |
| `youtube.upload` | Enviar vídeos e thumbnails tradicionais |
| `youtube.readonly` | Identificar o canal efetivamente autorizado e consultar vídeos/processamento do proprietário |

Não são solicitados escopos de edição ampla, exclusão, comentários ou gerenciamento de parceiros. `videos.update`, necessário para alterações remotas de status após o envio, exige permissões adicionais; por isso, alterações posteriores de agendamento/privacidade ficam no YouTube Studio nesta etapa. [Documentação de atualização](https://developers.google.com/youtube/data/reference/rest/v3/videos/update).

7. Copie o ID e o segredo do cliente para o backend. Não os coloque em variáveis `VITE_*`.
8. Para distribuição além do ambiente de teste, confira verificação OAuth, domínios, políticas e exigências aplicáveis ao seu projeto. O aplicativo respeita recusas da API e não contorna restrições.

Referência do fluxo: [OAuth para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server).

## Conectar um canal

1. Abra **Integrações → YouTube** no menu lateral.
2. Entre com a chave local em **Acesso ao estúdio**, se necessário.
3. Selecione **Conectar canal Google/YouTube**.
4. Escolha a identidade/canal no Google e conceda as permissões apresentadas.
5. Ao retornar, confira nome, ID e estado do canal. A aplicação identifica o canal pela resposta oficial `channels.list(mine=true)`, sem aceitar um channel ID arbitrário do frontend.

O backend utiliza Authorization Code, `state` aleatório com validade de dez minutos e consumo único, cookie HttpOnly vinculado ao navegador e PKCE S256. O callback também exige a sessão local autenticada. Cancelamento, negação, expiração, navegador divergente e reutilização de state não concluem a conexão. Tokens não são enviados no retorno ao frontend.

O pedido inclui acesso offline. As credenciais são armazenadas com AES-256-GCM e contexto vinculado ao proprietário e à conexão. A renovação reutiliza o refresh token anterior se o Google não fornecer outro; `invalid_grant` exige reconexão. Locks no PostgreSQL evitam renovações simultâneas para a mesma conexão.

## Preparar e enviar um vídeo

1. Gere e conclua um RenderJob na produção.
2. Em **Publicação**, escolha **YouTube tradicional** ou **YouTube Shorts**. O destino Instagram não oferece ação de envio.
3. Revise e salve título principal, descrição, hashtags, tags, capítulos e thumbnail/capa. Marque a preparação como **pronta**.
4. Em **Publicar no YouTube**, escolha explicitamente o canal.
5. Responda às declarações de conteúdo destinado a crianças e de mídia sintética/alterada realista. Revise categoria e licença. O uso de IA não responde automaticamente a essas perguntas.
6. Selecione a privacidade; mantenha privado para o primeiro teste.
7. Clique em **Validar para YouTube**. A validação usa a preparação salva e seus arquivos, sem criar vídeo remoto.
8. Para enviar, habilite `YOUTUBE_UPLOADS_ENABLED=true` no backend e reinicie a API. Clique em **Enviar como privado** e confira a confirmação, que apresenta os dados do snapshot salvo: canal, título, privacidade e eventual data/fuso.

Abrir a tela, selecionar um canal, validar e criar rascunho não iniciam upload. A confirmação coloca o job na fila. Alterações posteriores no projeto não modificam seu snapshot.

O limite local de envio nesta etapa é 2 GiB, compatível com o padrão do renderizador. O arquivo precisa ser MP4, estar disponível e ter sido registrado pelo renderizador como H.264/AAC. São reutilizados a validação do render, os metadados do asset e uma leitura limitada do cabeçalho MP4; não é criado outro renderizador. O arquivo original não é alterado.

## Upload, progresso e retomada

O worker utiliza PostgreSQL, sem introduzir Redis/BullMQ. Um lock de liderança limita a execução a um worker de upload por banco; cada publicação também possui lock próprio. A fila persiste no banco e sobrevive ao fechamento do navegador e reinícios da API.

O envio usa streaming em partes de até 8 MiB. O MP4 não é carregado integralmente na memória. A URL da sessão é criptografada. O progresso exibido corresponde aos bytes confirmados pelo servidor, e não a estimativas de tempo.

Antes de retomar, o worker consulta o offset remoto. HTTP 308 confirma um intervalo; uma resposta final pode recuperar o ID mesmo se a aplicação tiver perdido a resposta do último trecho. Falhas temporárias seguras recebem backoff limitado, até seis tentativas; cotas e recusas definitivas não provocam repetição automática. `Retry-After` é respeitado.

Há duas proteções contra duplicação: chave de idempotência e índice único por proprietário/canal/RenderJob, independente de selecionar destino tradicional ou Shorts. Um rascunho cancelado antes de qualquer tentativa pode ser corrigido e recriado com outra chave; registros enviados ou com resultado incerto continuam protegidos. [Protocolo oficial retomável](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol).

O marcador de início é persistido antes de `videos.insert`. Se uma falha deixar esse marcador sem uma sessão conhecida, o estado será **NEEDS_ATTENTION**. Sessão expirada também exige conferência. Não se inicia outro vídeo automaticamente nesses casos. Após conferir o Studio, é possível informar o ID de um vídeo existente; o servidor valida o canal antes de vinculá-lo ao histórico.

## Processamento e histórico

Upload recebido não significa vídeo público. O aplicativo consulta `videos.list` com `snippet,status,processingDetails` e apresenta os estados confirmados: processamento, privado, não listado, agendado, público, falha ou necessidade de conferência. Um recurso removido/indisponível exige atenção e não dispara novo upload.

O polling remoto usa intervalos conservadores: aproximadamente 30 segundos durante processamento, cinco minutos para agendados e seis horas para estados concluídos. O histórico da interface consulta apenas o banco a cada 15 segundos. Consultas manuais têm intervalo mínimo e não são feitas por GET com efeito colateral.

Links são construídos somente após validar o video ID. Um link pode existir para um vídeo ainda privado. O histórico permite filtrar canal/status, consultar eventos, conferir o estado remoto, retomar quando seguro e tratar thumbnail separadamente.

## Thumbnails e Shorts

Thumbnails tradicionais reutilizam a composição JPEG da etapa 7, abaixo de 2 MiB, e `thumbnails.set`. Se o MP4 for recebido e a thumbnail falhar, apenas a thumbnail será marcada como falha e poderá ser reenviada explicitamente; o vídeo não é reenviado. A conta pode recusar customização por falta de permissão. [API de thumbnails](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set).

Shorts são enviados pelo mesmo `videos.insert`, com validação vertical e duração real de até 180 segundos. Não existe chamada separada de upload para Shorts, nem garantia de classificação pelo aplicativo. A capa fica disponível para uso manual: a documentação atual informa a personalização de Shorts pelo Studio no computador, e esta implementação não promete envio da capa pela API. [Ajuda de thumbnails](https://support.google.com/youtube/answer/72431?hl=en), [elegibilidade de Shorts](https://support.google.com/youtube/answer/15424877?hl=en).

## Agendamento e cancelamento

O agendamento é de **publicação no YouTube**, não de início do upload. O arquivo é enviado após a confirmação, com privacidade privada e `status.publishAt` futuro. O instante é salvo em UTC e o fuso escolhido é preservado para apresentação. O formulário rejeita horários locais inexistentes/ambíguos; o backend valida fuso e antecedência. Se a data já tiver passado quando o job executar, não se envia um `publishAt` passado.

Ative `YOUTUBE_PUBLIC_PUBLICATION_ENABLED=true` somente quando quiser permitir conteúdo não privado ou agendamento. O estado **SCHEDULED** depende da resposta da API; o relógio local não transforma um job em **PUBLISHED**. As regras oficiais exigem vídeo privado e nunca publicado para `publishAt`. [Recurso de vídeo](https://developers.google.com/youtube/data/reference/rest/v3/videos).

**Interromper envio local não exclui vídeo nem cancela agendamento remoto.** Um trecho em trânsito pode ser recebido antes da interrupção. Alterações posteriores de privacidade, agendamento e exclusão devem ser feitas explicitamente no Studio. Não há exclusão automática ou tentativa de edição remota com escopos insuficientes.

## Automação explícita

Por padrão não há regra. A seção de automação permite:

- Criar somente um rascunho de envio.
- Enviar privado.
- Enviar privado e programar a publicação após um número configurado de horas.

A ativação exige confirmação, canal, destino, declarações, limite e, quando aplicável, flags do servidor. A regra exige preparação marcada como pronta e um RenderJob concluído. Ela não escolhe arbitrariamente outra versão nem transforma um render recém-gerado em aprovação editorial.

O limite configurável é de 1–10 registros por projeto e conta também o histórico já criado. Falhas não criam loops de novas publicações. Uma regra pode ser desativada sem fornecer novamente declarações; a desconexão do canal também a desativa. O modo rascunho pode funcionar com uploads desabilitados, desde que a integração esteja configurada. A política de agendamento é um atraso de 1–720 horas da preparação, não um calendário recorrente.

## Revogação, manutenção e rotação

**Desconectar** tenta revogar a autorização no Google, remove as credenciais locais, bloqueia novos envios, sinaliza jobs pendentes e preserva histórico. Se a revogação remota falhar, a interface informa a remoção apenas local e orienta revogar também em [permissões Google](https://myaccount.google.com/permissions).

A revogação Google pode invalidar outras autorizações do mesmo projeto/conta; confira outras conexões se necessário. A aplicação trata posteriormente autorizações recusadas como expiradas, exigindo reconexão.

Para rotacionar a criptografia, configure novo `YOUTUBE_ENCRYPTION_KEY_ID` e nova chave. `YOUTUBE_PREVIOUS_ENCRYPTION_KEYS` aceita um JSON de IDs/chaves anteriores, mantido apenas no gerenciador de segredos. Não remova uma chave anterior enquanto houver credenciais, sessões retomáveis ou estados OAuth pendentes cifrados com ela. Faça backup seguro das chaves separadamente do banco; perder a chave impede recuperar os tokens e sessões.

O isolamento atual é o modo local aprovado nas etapas anteriores: uma chave de acesso e um proprietário configurado no servidor. Consultas e vínculos validam esse proprietário. Isso não equivale a um sistema SaaS de login multiusuário.

## Cotas e erros

A tela de integrações mostra tentativas por operação/resultado nas últimas 24 horas. São contagens locais, sem estimativa fixa de unidades. Confira o consumo e os limites reais no Google Cloud Console.

Na consulta oficial de 25/10/2026, `videos.insert` possui bucket de uploads com padrão de 100 chamadas/dia e custo de uma unidade nesse bucket; os demais endpoints seguem seus próprios custos/limites. Não foi utilizado o antigo custo fixo de 1.600 unidades por upload. [Quota de upload](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [cotas e auditorias](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits).

A documentação atual também não descreve uma restrição universal a privado para todo projeto não verificado. Verificação de consentimento OAuth, políticas, cotas e restrições efetivas de cada conta/projeto continuam aplicáveis. O software utiliza privado por padrão e respeita recusas; não garante aceitação pública.

| Sintoma | Ação |
| --- | --- |
| OAuth não configurado | Preencher somente o backend, aplicar migration e reiniciar |
| `redirect_uri_mismatch` | Conferir URI exata no cliente web do Google e no ambiente |
| Consentimento negado/expirado | Iniciar conexão novamente no mesmo navegador autenticado |
| `AUTH` / `invalid_grant` | Reconectar o canal; verificar revogação e estado do aplicativo |
| `QUOTA` | Conferir cotas/limites do Google; não insistir automaticamente |
| `PERMISSION` | Conferir escopos, identidade do canal e capacidade da conta |
| `SESSION_EXPIRED` / `UNCERTAIN` | Conferir Studio e reconciliar; não criar outro vídeo às cegas |
| Falha da thumbnail | Repetir somente thumbnail quando permitido |
| Data ultrapassada | Cancelar o registro ainda não iniciado e criar novo rascunho revisado |
| Vídeo removido/indisponível | Conferir Studio, conta autorizada e histórico; não reenviar automaticamente |

Os logs de operações não contêm tokens, secrets, corpos privados ou URLs de sessão. Configure proxies de produção para não registrar a query string do callback OAuth.

## Testes automatizados e teste real opcional

Os testes automatizados usam banco descartável e simulador HTTP local. OAuth, renovação, 308, interrupção após o último trecho, retomada, privacidade, agendamento, capas, falhas, revogação e automação são simulados. Nenhum teste publica ou conecta conta Google real.

Com o PostgreSQL descartável iniciado e o build da API concluído:

```sh
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:youtube-publishing:integration
```

**Procedimento opcional real, não executado durante a implementação:** após autorização explícita, configure um canal de teste, conecte pelo OAuth, produza um MP4 pequeno e identificável, mantenha privado e confirme o envio. Confira videoId, processamento, link, histórico e arquivo privado no Studio. Não altere para público e não exclua o vídeo automaticamente. Esse teste depende das suas credenciais, do consentimento e da disponibilidade da conta.
