# Etapa 10 — Edição inteligente avançada com IA

Implementação em 26/10/2026. A análise propõe decisões editoriais; a renderização continua no FFmpeg existente. Nenhuma chamada paga foi executada durante a implementação.

## Diagnóstico inicial e arquitetura reutilizada

O repositório já tinha ContentProject/Scene, assets imutáveis, seleção de imagens/narrações, RenderJob com snapshot, TimelineBuilder, FfmpegRenderer, AudioTimelineBuilder/AudioMixService, SubtitleBuilder, storage local e edição persistida por proporção. Movimento, amplitude, fit, focalX/Y e zoom já eram suportados. As transições eram globais; a interpolação era um booleano de suavização. O provider textual usava Responses + Zod, mas não aceitava imagens. Não existiam análise visual, planos editoriais versionados, fila de análises ou aprovação dessas sugestões.

A etapa amplia essas estruturas. Não duplica renderização, imagem, narração, áudio, legendas ou publicação. Os serviços são registrados no ContentAssetsModule existente e reutilizam AiModule/LlmProvider e os repositories atuais.

Fluxo: projeto e seleções → análise visual incremental → planejamento global do roteiro → validação → revisão → aplicação explícita em EditingSettings → TimelineBuilder → snapshot do RenderJob → FFmpeg.

## Serviços e arquivos

- `api/src/content-intelligent-editing/intelligent-editing.service.ts`: autorização, captura das fontes, solicitação, revisão, aplicação, restauração e preview.
- `editing-analysis.worker.ts`: fila persistente, concorrência global de uma análise, progresso, cache, cancelamento, tratamento de falhas e planejamento global.
- `editing-plan.repository.ts`: PostgreSQL, versões, eventos, cache e lock do worker.
- `editing-plan.schema.ts`: análise narrativa/visual, sugestões, limites e conversão segura.
- `intelligent-editing.controller.ts`: endpoints do projeto.
- `api/migrations/014_intelligent_editing.sql`: planos/jobs, cache por proprietário e eventos.
- `api/src/ai/llm.provider.ts` e `openai-llm.provider.ts`: entrada opcional de imagens, AbortSignal e limite de saída no provider existente. Logs não incluem o corpo ou a mensagem bruta de erro do provider.
- `api/src/video-render/`: ampliação de EditingSettings, transições por cena, interpolação, proveniência e preservação dessas decisões na prévia/snapshot.
- `api/src/content-publication/content-access.ts`: acesso fechado sem chave e verificação de Origin nas novas mutações.
- `frontend/src/pages/ContentCreation/components/IntelligentEditing.jsx`: painel retrátil de análise/revisão.
- `VideoProduction.jsx` e `VideoEditingControls.jsx`: integração, proteção manual e atualização após aplicação.
- `frontend/src/services/intelligentEditingService.js`, `frontend/src/types/intelligentEditing.d.ts`: cliente autenticado e contratos.
- `.env.example`, `api/package.json` e runner de migrations: configuração e comandos.
- Testes: `intelligent-editing.spec.ts`, ampliação de `openai-llm.provider.spec.ts`, `api/test/content/intelligent-editing.integration.cjs`, `intelligent-editing.browser.cjs`, `frontend/test/intelligentEditing.test.mjs`.

## Análise narrativa e visual

O planejamento global recebe o roteiro inteiro, cenas na ordem, falas, durações reais dos áudios selecionados, formato, análises visuais, mixagem e configurações de legenda. A interpretação inclui função narrativa INTRODUCTION/DEVELOPMENT/SUSPENSE/TENSION/REVELATION/CLIMAX/RESOLUTION, tensão de 0 a 1 (escala editorial, não confiança estatística), tom emocional, ritmo, continuidade e explicação curta.

Cada imagem selecionada pode ser analisada por modelo visual configurado. São identificados assunto, ponto focal aproximado, região importante, composição horizontal/vertical e sugestão textual de área de legendas. Não há reconhecimento de identidade. As imagens são convertidas localmente para JPEG de até 1024 pixels por lado, qualidade 78, antes do envio. Os originais permanecem intactos.

A implementação usa entrada `input_image` e respostas estruturadas no provider existente, conforme a [documentação oficial de imagens e visão da OpenAI](https://developers.openai.com/api/docs/guides/images-vision). A conta deve ter acesso a um modelo que aceite imagens e saída estruturada; o sistema não presume essa capacidade de qualquer nome arbitrário configurado.

## Configuração e operação

Antes de iniciar a API atualizada:

```bash
cd api
npm run migrate:intelligent-editing
npm run start:dev
```

O runner também é usado pelos comandos anteriores de migrations e inclui a 014. Não há mudança destrutiva nas tabelas anteriores.

Variáveis, sem valores secretos no repositório:

| Variável | Comportamento |
| --- | --- |
| CONTENT_ACCESS_KEY | Obrigatória para acessar a edição inteligente. Usa a sessão local existente. |
| CONTENT_OWNER_ID | Proprietário local do servidor; padrão `local-owner`. |
| OPENAI_API_KEY | Credencial do provider existente; nunca enviada ao navegador. |
| INTELLIGENT_EDITING_MODEL | Modelo do plano textual; se vazio herda OPENAI_MODEL e, na ausência deste, o padrão existente `gpt-5.6-luna`. |
| INTELLIGENT_EDITING_VISUAL_MODEL | Modelo visual escolhido explicitamente pelo administrador. Vazio desativa chamadas visuais e usa enquadramento estático seguro. |
| INTELLIGENT_EDITING_MAX_SCENES | Padrão 40; limitado a no máximo 80 cenas por análise. |

Na Produção → Montagem do vídeo → Edição Inteligente: selecione formato, estilo e intensidade, clique em **Analisar projeto com IA** e confirme o possível consumo. Revise cada sugestão, edite/aceite/rejeite ou aprove todas as não rejeitadas. Clique em **Aplicar plano**. Depois use **Gerar prévia FFmpeg** ou a geração normal do vídeo. Aplicar não inicia renderização nem publicação automaticamente.

## Plano, revisão e versões

Cada solicitação cria uma versão independente. Estados: PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED, APPROVED, APPLIED e RESTORED. COMPLETED é um rascunho aguardando revisão. Cada sugestão tem decisão PENDING/ACCEPTED/REJECTED. A aplicação exige todas revisadas e ao menos uma aceita. Aprovar todas preserva rejeições explícitas.

Planos guardam modelo, versão dos prompts, estilo, intensidade, formato, referências e hashes de imagem, contexto analisado, edição anterior à análise, consumo conhecido, sugestões, validações, datas e revisão otimista. Eventos registram revisão, aplicação, cenas aplicadas/preservadas, restauração, cache e falhas. Planos anteriores não são apagados.

Aplicação e atualização do plano/evento usam a mesma transação PostgreSQL sob lock do projeto. Conflitos de revisão impedem sobrescrever uma revisão de outra janela.

## Preservação manual e comparação

Configurações manuais existentes são protegidas por padrão. A caixa **Proteger configuração contra IA** permite bloqueio explícito. Um desbloqueio explícito (`locked: false`) permite substituição após aprovação; editar um controle não equivale a consentir silenciosamente com alterações futuras. Configurações manuais legadas com movimento explícito também ficam protegidas quando o bloqueio ainda não existe no JSON.

Sugestões rejeitadas e cenas protegidas mantêm os valores anteriores. A interface mostra o movimento/enquadramento anterior, sugestão, configuração validada, motivo e avisos. Proveniência por cena: MANUAL, AI ou AUTO, com planId quando aplicável. Ao salvar alterações manuais, a proveniência da cena é atualizada.

**Restaurar configurações anteriores** usa o estado anterior à aplicação. Se houver qualquer edição posterior, a restauração é bloqueada para não apagar trabalho mais recente. O histórico e os vídeos anteriores continuam disponíveis.

## Validação técnica, movimentos e composição

Respostas do modelo são dados não confiáveis. Zod valida campos obrigatórios, enums, números finitos, limites, quantidades, SceneIds e duplicações. Regiões devem ter dimensão positiva e permanecer dentro da imagem. Não são aceitos filtros, comandos ou expressões arbitrárias.

Os movimentos são os sete presets existentes. Intensidade recomendada mapeia para amplitude SUBTLE=0,02, MODERATE=0,045 e STRONG=0,08, limitada também pela intensidade global. Zoom adicional é limitado a 1,15 e o ajuste é registrado. LINEAR, EASE_IN, EASE_OUT e EASE_IN_OUT são expressões internas controladas do filtro de movimento existente.

CONTAIN e BLURRED_BACKGROUND preservam o primeiro plano estático. Sem visão utilizável, o fallback preserva a imagem inteira, centralizada e estática. Para COVER, uma checagem conservadora da região principal considera proporção, ponto focal, zoom e margem de movimento; se houver risco geométrico de recorte, retorna à imagem inteira com aviso. Coordenadas/regionais multimodais continuam aproximadas e exigem revisão humana.

## Transições, ritmo e continuidade

A sugestão pode variar CUT, FADE ou CROSSFADE por cena. O TimelineBuilder limita a duração pela pausa após a narração, quantização em frames e metade das cenas adjacentes. Não encurta a timeline nem desloca fala, efeitos ou legendas. A duração efetiva pode ser menor ou virar CUT.

O planejamento considera as cenas em conjunto para evitar repetições e contradições. Estilo e intensidade são enviados ao planejamento com instruções distintas e o backend limita a amplitude efetiva. Não se promete qualidade cinematográfica apenas pela escolha de um preset; ritmo e intenção editorial precisam de revisão humana.

Mudanças na duração das cenas, falas, velocidade do áudio, música ou efeitos aparecem somente como recomendações. A etapa não corta frases, não acelera áudio e não altera roteiro aprovado.

## Formatos, legendas e áudio

16:9 e 9:16 recebem planos e decisões próprios. Ao aplicar um formato, as configurações salvas do formato anterior são preservadas em variants. Não se copia cegamente o crop entre proporções.

Áreas de legenda são recomendações visuais, sem posicionamento automático por cena. Safe areas, tempos, fontes e controles existentes continuam sendo usados. Música, ducking, volume, narração e efeitos não são alterados pelo plano.

## Snapshot e FFmpeg

EditingSettings grava appliedPlan com ID, versão, revisão aprovada, hash da fonte, estilo e intensidade. RenderSnapshot captura essa edição e, por cena, movimento efetivo/solicitado, interpolação, amplitude, ponto focal, fit, zoom, transição efetiva, duração e proveniência. Assets e áudio continuam sendo capturados no mesmo snapshot.

Planos e edições posteriores não modificam RenderJobs já criados. O FFmpeg recebe apenas decisões convertidas e validadas pelo backend.

O preview reutiliza a fila e o renderer existentes, em 640×360 ou 360×640, com até duas cenas e até três segundos por cena. É silencioso, acelera o movimento e não incorpora as legendas nessa prévia. A proporção, o crop, o movimento e o tipo/duração efetiva de transição derivam do plano aplicado. A interface identifica essas limitações. O preview estático de crop é explicitamente aproximado. O MP4 completo é a referência para som, ritmo real e legendas.

## Detecção de plano desatualizado

O hash da fonte inclui revisão e conteúdo do roteiro/cenas, ordem, imagens selecionadas e hash dos bytes, versões/fingerprints, narrações e durações, formato, mixagem e configuração/seleção de legendas. A revisão de edição é conferida separadamente. O endpoint do plano recalcula a validade e a aplicação repete a conferência sob lock.

Trocas de assets, remoção/adição de cenas, alterações no texto, timeline ou formato invalidam a aplicação. O plano continua no histórico e pode ser reanalisado. A troca de formato feita pela própria aplicação é tratada como alteração intencional, sem invalidar imediatamente o plano recém-aplicado.

## Custos, cache, fila e recuperação

Não há análise ao abrir projeto ou painel. A ação explícita mostra quantidade de cenas e modelos e pede confirmação. Há uma análise ativa por projeto e uma chamada de cada vez no worker global, coordenado por advisory lock PostgreSQL entre processos.

Cada imagem tem cache por proprietário, hash de conteúdo, modelo, tamanho técnico e versão do prompt. Reanálises em outro formato/estilo reaproveitam a análise visual e refazem o planejamento global. O plano global também tem cache por fonte, edição anterior, modelos, estilo, intensidade e prompt. A revisão do usuário nunca altera o conteúdo em cache.

Cada operação é limitada ao número de cenas configurado e tamanho do contexto textual de 250 KB; imagens têm limite de 25 MiB por arquivo e decodificação de no máximo 40 milhões de pixels. Saídas limitadas a 1.800 tokens por análise visual e 24.000 no planejamento. Não há retries automáticos do SDK nessas chamadas. Falha visual individual produz fallback; falha do planejamento deixa um job FAILED sem modificar a edição.

Progresso, consumo conhecido e resultados concluídos são persistidos. Cancelamento verifica o banco entre cenas e aborta a chamada em andamento quando o provider suporta AbortSignal. Uma requisição já recebida pelo provider pode ter consumo mesmo após cancelamento.

Após reinício, PENDING pode continuar (solicitação explícita já registrada). PROCESSING interrompido vira FAILED ou CANCELLED: não se repete automaticamente uma chamada potencialmente faturada. A tentativa seguinte é uma nova versão solicitada pelo usuário e reutiliza caches completos. Não há cálculo de dólares estimado; tokens conhecidos são mostrados e a cobrança efetiva depende do modelo/conta.

## Endpoints

Prefixo `/content-projects/:projectId/intelligent-editing`:

| Método e rota | Função |
| --- | --- |
| POST /analyze | Solicita job; revisão do projeto, formato, estilo, intensidade e confirm=true. |
| GET /plans | Configuração pública e histórico do proprietário. |
| GET /plans/:planId | Plano, validade atual e eventos. |
| PATCH /plans/:planId | Aceita/rejeita/edita sugestão com revisão otimista. |
| POST /plans/:planId/approve | Aprova sugestões não rejeitadas. |
| POST /plans/:planId/apply | Aplica plano aprovado; revisão + confirm=true. |
| POST /plans/:planId/restore | Restaura edição anterior se ainda não houver edições posteriores. |
| POST /plans/:planId/cancel | Solicita cancelamento da análise. |
| POST /plans/:planId/preview | Cria prévia pelo renderer existente; plano aplicado e atual. |

Retry é uma nova solicitação explícita em `/analyze`, preservando as versões anteriores.

## Segurança

Autenticação usa ContentAccessGuard, bearer/cookie HttpOnly da sessão local, chave exigida e validação de Origin nas mutações do navegador. O serviço também verifica owner_id do projeto; planos/cache são filtrados pelo proprietário. Assets são obtidos exclusivamente do projeto e da seleção persistida. UUIDs, payloads, schemas e revisões são validados.

Prompts de sistema separam instruções confiáveis de textos/imagens não confiáveis. O provider não tem ferramentas, shell, acesso a segredos ou funções de renderização. Dados de resposta não se tornam comandos. Não são retornados storage keys ou credenciais no DTO do plano. Logs do provider não expõem mensagens brutas que possam conter payloads.

## Testes e evidências

Verificações executadas:

- Backend: build Nest, TypeScript sem emissão e lint dos arquivos alterados. Suíte completa: **47 suites, 456 testes aprovados**.
- Frontend: build Vite, lint e **80 testes aprovados**, incluindo contratos e apresentação da edição inteligente. Declarações TypeScript conferidas separadamente.
- Integração: migration 014 e migrations anteriores aplicadas duas vezes em um banco descartável; Nest HTTP real, autorização, revisões, cache, concorrência de workers, cancelamento, recuperação, aprovação, rejeição, proteção manual, aplicação parcial, restauração, detecção de fontes antigas e falhas simuladas de provider.
- Renderização real: **cinco cenas, 8 segundos**, saídas H.264/AAC em **1920×1080 e 1080×1920**, com narração, música, efeito sonoro e legendas. Conferidas duração, frequências dos áudios nos offsets esperados, assunto principal dentro dos frames, ausência de bordas inesperadas em COVER, pan na direção aprovada, zoom-out, legenda visível no tempo previsto e snapshot imutável. CUT/FADE/CROSSFADE constam das decisões por cena executadas.
- Chrome real: confirmação de análise paga, edição de sugestão, rejeição, aprovação, aplicação, pedido de preview, persistência após recarga, restauração e layouts 1440/768/390 sem overflow.
- `git diff --check` aprovado. **Zero chamadas pagas reais**; todas as respostas de IA foram simuladas.

Evidências finais locais em `/tmp/trends-intelligent-8r0Om4/`:

- `evidence.json`: consumo simulado, snapshots e resultados técnicos.
- `intelligent-16-9.mp4` e `intelligent-9-16.mp4`: vídeos de fixtures renderizados pelo FFmpeg de produção.
- `frame-16-9-*.png` e `frame-9-16-*.png`: frames de cinco momentos relevantes.
- `intelligent-editing-ui.png`: captura da interface no Chrome.

Os arquivos em `/tmp` são evidências temporárias e não precisam ir para o GitHub. A inspeção visual confirmou a apresentação legível e a presença do assunto/legendas nas fixtures; isso não substitui revisão editorial de histórias reais.

A tentativa de executar `npm run migrate:editing` contra o banco configurado da aplicação terminou com **ECONNREFUSED**. Portanto, a migration **não foi aplicada nesse banco nesta entrega**. Inicie o PostgreSQL correto e execute `npm run migrate:intelligent-editing` dentro de `api` antes de usar o painel. O banco descartável foi usado para validar a migration e os fluxos, sem alterar dados do usuário.

## Limitações e pendências operacionais

- Configurar um modelo visual compatível é necessário para a análise real das imagens; o padrão é opt-in explícito, sem chamadas visuais quando vazio.
- A chave OpenAI, acesso aos modelos e disponibilidade comercial da conta não foram testados com chamadas pagas.
- Ponto focal/região são estimativas visuais, sem rastreamento ou garantia de detecção perfeita. A proteção geométrica pode preferir imagem inteira e reduzir movimentos.
- Recomendações de legenda/áudio/duração não são aplicadas automaticamente.
- Não há editor profissional, novas transições, geração de vídeo por IA ou alterações na publicação.
- A análise não é um critério automático de qualidade cinematográfica. A revisão humana avalia narrativa e estética.
- A fila limita a concorrência, mas uma análise pode durar vários minutos; o cancelamento não garante estorno de requisições já recebidas.
- Cache e histórico são persistentes, sem limpeza automática nesta etapa. A retenção é responsabilidade do administrador.
- A aplicação é por plano aprovado, podendo preservar/rejeitar cenas individualmente. Para alterar um plano já aplicado, crie outra versão ou use os controles manuais.
