const {readFileSync,writeFileSync}=require('node:fs');const {resolve}=require('node:path');const root=resolve(__dirname,'..');
const r=JSON.parse(readFileSync(resolve(root,'reports/canonical-comparison.json'),'utf8')),b=JSON.parse(readFileSync(resolve(root,'reports/canonical-before.json'),'utf8'));
const text=`# Consolidação de assuntos — Temas em Alta

Diagnóstico antes da alteração: ${b.capturedAt}. Comparação: ${r.comparedAt}. Região BR; mesmos ${r.videoCount} IDs, metadados e embeddings do arquivo inicial.

## Causa raiz

O pipeline original reproduziu 69 grupos e 47 unitários. O complete-link exige similaridade mínima entre todos os pares; centroids próximos não bastam. A entidade compartilhada acrescentava apenas 0,04 ao cosine. A nomeação ocorria depois da partição e podia dar o mesmo nome a vários grupos. Não havia consolidação. O matching persistente era um para um: um ID já utilizado não podia receber o segundo grupo. A ordenação era determinística; a duplicação não veio da ordem ou da ausência de embeddings/centroids.

Havia oito temas chamados Roblox. Os pares da tabela abaixo compartilhavam Roblox. No algoritmo original, a similaridade mínima entre vídeos + 0,04 precisava atingir 0,75. IDs, títulos, canais, tags, descrições, semanticText, entidades detectadas, cosine ao centroid e vetores completos estão em [canonical-before.json](reports/canonical-before.json). Esse diagnóstico executou o clustering original com os embeddings armazenados, sem chamar o provedor ou alterar o banco.

## Casos reais

- **GTA 5:** dois uploads de GTA HYPE/GTA GARDEN compartilham título e descrição com “Spider-Man Rescue batman ... Game GTA 5 superhero”. A categoria cadastrada é Music, mas o texto identifica gameplay. O assunto final é GTA 5; Batman, Homem-Aranha, Iron Man e Venom são entidades secundárias. O terceiro vídeo é de GTA 5 Online, com cosine 0,5858 entre seu centroid e o grupo anterior.
- **Simone Mendes:** título e canal identificam a cantora, reconhecida por entidade clara. O resultado foi preservado.
- **The Sweet Spot:** a descrição informa literalmente “Nome do Jogo: The Sweet Spot”; canal Jazzghost, categoria Gaming. Os metadados sustentam o jogo como assunto. Sorvete e sorveteria descrevem a atividade; não há fundamento para assumir empresa física ou negócio de sorvetes.
- **Vision Quest:** título e descrição discutem o trailer da obra. Vision Quest foi mantido como assunto específico; Marvel aparece como entidade secundária. Não se assume que toda referência a Marvel deva ser um único tema.
- **Se Cuida Aí:** o prefixo do título era confundido com artista. A heurística agora exige confirmação pelo canal ou por créditos de voz. Neste vídeo, canal e título sustentam Cleber & Cauan.

## Modelagem e estratégia

O título é entrada. primaryTopic identifica o assunto central; entities reúne personagens, obras e assuntos secundários; keywords descreve contexto. Não foi criada hierarquia de tabelas. O catálogo é pequeno: aliases explícitos e três relações de jogos com Roblox (Roube um Ovo, Brookhaven, Blox Fruits). Essas relações exigem contexto adicional de jogo ou Roblox; nome de jogo sozinho em contexto indefinido não associa à plataforma.

A identificação prioriza jogo/plataforma explícito no título sobre personagens; aceita declaração de nome do jogo na descrição; e usa tags corroboradas por descrição ou Gaming, com veto a assunto concorrente explícito. Categoria sozinha e tag isolada fora desse contexto não bastam. A canonicalização normaliza acentos/espaços e aliases de entidade (GTA V/Grand Theft Auto V → GTA 5; Spider-Man → Homem-Aranha), sem unir pelo nome exibido.

O clustering inicial mantém o limite **0,75**. A etapa seguinte exige primaryTopic canônico igual, confiança mínima 0,8 e compatibilidade dos embeddings. Quando todos os vídeos têm o assunto independentemente evidenciado pela heurística, cosine 0,55 funciona como veto de incompatibilidade. É uma regra própria de consolidação com evidência forte, não redução do threshold inicial. Os dados mostraram GTA 5 com 0,5858 e grupos Roblox moderadamente próximos; outros assuntos chegam a cosine 0,8345 com vídeos Roblox. Portanto cosine sozinho seria insuficiente. Classificações apenas por LLM exigem cosine mínimo 0,75. Todos os centroids dos grupos originais precisam ser compatíveis entre si, evitando união por cadeias de pontes.

Unitários passam pela mesma consolidação antes da criação de identidade. Os grupos finais são comparados com temas existentes por membros, centroid e primaryTopic; assunto canônico conflitante impede associação. Uma fusão preserva um ID existente quando compatível e atualiza vínculos na mesma transação. Registros antigos sem vínculos podem permanecer; o GET só lê temas ativos. Não há unicidade por canonicalKey, pois assuntos comprovadamente incompatíveis podem precisar permanecer separados.

Embeddings são reutilizados por modelo/hash do texto. Nenhum foi recalculado nesta tarefa. LLM é usado somente pelo worker quando heurística e cache não resolvem; recebe títulos, tags, texto limpo, canal, categoria e entidades. Retorna primaryTopic, entities, keywords e confidence. O cache das classificações dos grupos iniciais também é persistido para não repetir chamadas ao reconstruir um tema consolidado depois de restart. Falhas geram fallback explícito com tentativa após 24 horas; embeddings indisponíveis mantêm vídeos isolados e usam backoff. GET não depende de LLM, embeddings ou clustering.

## Banco e API

Migration aditiva **003_canonical_topics.sql**, aplicada no banco local: primary_topic, canonical_key, confidence, classification_cache JSONB e índice por região/modelo/canonicalKey. Nomes antigos não viram assunto automaticamente. Não houve exclusão de vídeos ou alteração de snapshots. Publicação mantém transação e lock. A API adiciona primaryTopic, canonicalKey, entities e confidence. Nenhuma mudança de UI, regra de ranking, score ou Estúdio de Criação.

## Comparação

| Medida | Antes | Depois |
|---|---:|---:|
| Vídeos | ${r.videoCount} | ${r.videoCount} |
| Temas | ${r.before.topics} | ${r.after.topics} |
| Unitários | ${r.before.singletons} | ${r.after.singletons} |
| Grupos redundantes canônicos confirmados | ${r.before.confirmedRedundantCanonicalGroups} | ${r.after.confirmedRedundantCanonicalGroups} |
| Temas chamados Roblox | 8 | 1 |

“Redundantes confirmados” conta grupos excedentes que passam pelas regras de assunto evidenciado/compatibilidade. Não é uma revisão humana de todos os possíveis sinônimos; desconhecidos podem conter duplicações. A redução total inclui mudanças na extração de entidades que afetam o clustering inicial.

Top 10 por crescimento em **7d**, com os snapshots disponíveis em ${r.metricsAsOf}. Cobertura parcial: não existem sete dias completos de coleta. Foi escolhido 7d porque o diagnóstico ocorreu logo após a virada do dia em São Paulo. Os mesmos IDs e instante de consulta são usados antes/depois. Soma: **${r.metricSumBefore} / ${r.metricSumAfter}**. A regra permanece SUM das diferenças por vídeo.

IDs, centroids finais, cache, histórico de processamento e ranking detalhado estão em [canonical-comparison.json](reports/canonical-comparison.json).
`;
const lines=[text,'## Pares Roblox do diagnóstico','','| Grupo A | Grupo B | Cosine centroids | Menor cosine entre vídeos |','|---|---|---:|---:|'];for(const p of b.robloxPairs)lines.push(`| ${p.a} | ${p.b} | ${p.centroidSimilarity.toFixed(4)} | ${p.minimumPairSimilarity.toFixed(4)} |`);
for(const [label,data] of [['ANTES',r.before],['DEPOIS',r.after]]){lines.push('',`## Top 10 — ${label}`,'');data.top10.forEach((t,i)=>lines.push(`### ${i+1}. ${t.name}`,'',`Vídeos: ${t.videoCount}; crescimento: +${t.viewsInPeriod}; primaryTopic: ${t.primaryTopic??'não separado no modelo anterior'}; entidades: ${(t.entities||[]).join(', ')||'nenhuma detectada'}; keywords: ${t.keywords.join(', ')}.`,'',...t.titles.map(title=>`- ${title}`)));}
const usage=r.processingHistory.reduce((a,h)=>({calls:a.calls+(h.diagnostics.namingCalls||0),tokens:a.tokens+(h.naming_usage.totalTokens||0),embeddings:a.embeddings+(h.diagnostics.generated||0)}),{calls:0,tokens:0,embeddings:0});
lines.push('',`## Verificação

- **67 testes, 11 suítes** passaram (npm run test:topics); provedores mockados. Cobrem aliases, Roblox, personagens vs assunto, assuntos diferentes com vetores semelhantes, tag/categoria insuficientes, pontes semânticas, artistas corroborados, fallback, unitário associado com ID preservado e unitário novo.
- Build Nest, ESLint dos TypeScript envolvidos e git diff --check passaram.
- PostgreSQL descartável: migrations, arrays/cache por hash/modelo, campos canônicos, transação/rollback, identidade, lock e uso separado passaram.
- HTTP/navegador: temas persistidos, soma 100000+200000+350000=650000, parâmetros, loading, períodos, detalhes, retry/erro/vazio e telas 1440/768/390 passaram.
- Histórico real desde o diagnóstico: ${usage.embeddings} embeddings gerados; ${usage.calls} chamadas de classificação, ${usage.tokens} tokens. Na execução final e em worker novo após restart: zero chamadas LLM, zero embeddings gerados e 105 embeddings reutilizados.

## Arquivos desta correção

Alterados: trends/semantic/topic-entities.service.ts; topic-naming.service.ts; semantic-topics.processor.ts; semantic-topics.repository.ts; semantic-topic.interface.ts; semantic.spec.ts; semantic-topics.processor.spec.ts; src/sources/youtube/youtube-metrics.repository.ts; trends/trending-topics.service.ts e seu teste; trends/interfaces/trending-topic.interface.ts; scripts/migrate-youtube.cjs; scripts/process-semantic-topics.cjs; test/youtube/semantic-persistence.integration.cjs; test/youtube/topics-browser.integration.cjs; SEMANTIC_TOPICS_REPORT.md.

Criados: trends/semantic/topic-consolidation.ts e seu teste; migrations/003_canonical_topics.sql; scripts/diagnose-canonical-topics.cjs; scripts/process-canonical-topics.cjs; scripts/write-canonical-report.cjs; reports/canonical-before.json; reports/canonical-comparison.json; CANONICAL_TOPICS_REPORT.md.

## Limitações e operação

Ainda há dois temas sem identificação confiável, incluindo dois vídeos do canal Mendrux sem metadados suficientes para afirmar Roblox/Minecraft. Foram preservados. São 43 unitários, muitos com assunto real distinto. Catálogo e limites de consolidação precisam de avaliação em outras amostras. Tags genéricas, metadados incorretos e inferências do LLM podem produzir erros. Confidence estima evidência e não é uma probabilidade calibrada. Relações de franquia fora do catálogo podem continuar separadas. O worker refaz o agrupamento regional quando o texto muda, reutilizando embeddings/classificações; processamento incremental sofisticado ficou fora do escopo.

Migration e processamento da amostra já foram executados. Reinicie o backend para carregar o worker corrigido; os temas consolidados já estão persistidos. GET serve esse estado e as próximas coletas seguem o fluxo novo.
`);
writeFileSync(resolve(root,'CANONICAL_TOPICS_REPORT.md'),lines.join('\n'));console.log('Relatório canônico gerado.');
