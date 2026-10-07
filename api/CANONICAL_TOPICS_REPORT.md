# Consolidação de assuntos — Temas em Alta

Diagnóstico antes da alteração: 2026-10-06T03:08:33.360Z. Comparação: 2026-10-06T03:20:51.664Z. Região BR; mesmos 105 IDs, metadados e embeddings do arquivo inicial.

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
| Vídeos | 105 | 105 |
| Temas | 69 | 55 |
| Unitários | 47 | 43 |
| Grupos redundantes canônicos confirmados | 11 | 0 |
| Temas chamados Roblox | 8 | 1 |

“Redundantes confirmados” conta grupos excedentes que passam pelas regras de assunto evidenciado/compatibilidade. Não é uma revisão humana de todos os possíveis sinônimos; desconhecidos podem conter duplicações. A redução total inclui mudanças na extração de entidades que afetam o clustering inicial.

Top 10 por crescimento em **7d**, com os snapshots disponíveis em 2026-10-06T03:20:49.845Z. Cobertura parcial: não existem sete dias completos de coleta. Foi escolhido 7d porque o diagnóstico ocorreu logo após a virada do dia em São Paulo. Os mesmos IDs e instante de consulta são usados antes/depois. Soma: **7107834 / 7107834**. A regra permanece SUM das diferenças por vídeo.

IDs, centroids finais, cache, histórico de processamento e ranking detalhado estão em [canonical-comparison.json](reports/canonical-comparison.json).

## Pares Roblox do diagnóstico

| Grupo A | Grupo B | Cosine centroids | Menor cosine entre vídeos |
|---|---|---:|---:|
| a4042cd7-d933-4d4a-b160-d54efd49c557 | e327a9bf-e0c4-487b-9012-d1a040f627be | 0.7217 | 0.6025 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 1f671e52-5664-402c-8de5-a417b6d6f295 | 0.8458 | 0.6656 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 7a7715a9-96f5-46ae-a70a-e4c271816151 | 0.8863 | 0.6877 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 66c79140-a668-4390-ad6d-fb3a4064ca86 | 0.8622 | 0.6893 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 26d8008a-91e7-4167-8c56-873822c570ba | 0.7389 | 0.6284 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.6970 | 0.6173 |
| a4042cd7-d933-4d4a-b160-d54efd49c557 | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.7291 | 0.6420 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 1f671e52-5664-402c-8de5-a417b6d6f295 | 0.6927 | 0.5591 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 7a7715a9-96f5-46ae-a70a-e4c271816151 | 0.7893 | 0.6570 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 66c79140-a668-4390-ad6d-fb3a4064ca86 | 0.7219 | 0.6065 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 26d8008a-91e7-4167-8c56-873822c570ba | 0.6255 | 0.5923 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.7189 | 0.6755 |
| e327a9bf-e0c4-487b-9012-d1a040f627be | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.6108 | 0.5817 |
| 1f671e52-5664-402c-8de5-a417b6d6f295 | 7a7715a9-96f5-46ae-a70a-e4c271816151 | 0.8819 | 0.7023 |
| 1f671e52-5664-402c-8de5-a417b6d6f295 | 66c79140-a668-4390-ad6d-fb3a4064ca86 | 0.8564 | 0.6974 |
| 1f671e52-5664-402c-8de5-a417b6d6f295 | 26d8008a-91e7-4167-8c56-873822c570ba | 0.7388 | 0.6598 |
| 1f671e52-5664-402c-8de5-a417b6d6f295 | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.6927 | 0.6030 |
| 1f671e52-5664-402c-8de5-a417b6d6f295 | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.7430 | 0.6611 |
| 7a7715a9-96f5-46ae-a70a-e4c271816151 | 66c79140-a668-4390-ad6d-fb3a4064ca86 | 0.8651 | 0.6699 |
| 7a7715a9-96f5-46ae-a70a-e4c271816151 | 26d8008a-91e7-4167-8c56-873822c570ba | 0.7443 | 0.6544 |
| 7a7715a9-96f5-46ae-a70a-e4c271816151 | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.6963 | 0.5790 |
| 7a7715a9-96f5-46ae-a70a-e4c271816151 | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.7376 | 0.6318 |
| 66c79140-a668-4390-ad6d-fb3a4064ca86 | 26d8008a-91e7-4167-8c56-873822c570ba | 0.7336 | 0.6802 |
| 66c79140-a668-4390-ad6d-fb3a4064ca86 | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.7429 | 0.6864 |
| 66c79140-a668-4390-ad6d-fb3a4064ca86 | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.7306 | 0.6752 |
| 26d8008a-91e7-4167-8c56-873822c570ba | 1e6e3315-483f-4a26-95c5-1c7525408408 | 0.6677 | 0.6677 |
| 26d8008a-91e7-4167-8c56-873822c570ba | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.6815 | 0.6815 |
| 1e6e3315-483f-4a26-95c5-1c7525408408 | 567da43b-0102-4ad4-8d3b-a2ceef597944 | 0.6607 | 0.6607 |

## Top 10 — ANTES

### 1. GTA 5 com super-heróis

Vídeos: 2; crescimento: +1014491; primaryTopic: não separado no modelo anterior; entidades: Batman, GTA 5; keywords: GTA 5, Batman, Homem-Aranha, Venom, Iron Man.

- الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero
- الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero
### 2. Roblox

Vídeos: 2; crescimento: +584357; primaryTopic: não separado no modelo anterior; entidades: Roblox; keywords: Roblox, Gameplay.

- Steal an Egg Bosses Characters in REAL LIFE!
- Steal an Egg But I Turned My Friends Into BOSSES!
### 3. Simone Mendes

Vídeos: 1; crescimento: +518389; primaryTopic: não separado no modelo anterior; entidades: Simone Mendes; keywords: Simone Mendes.

- Simone Mendes - CÊ PERDEU (O MELHOR DE MIM)
### 4. The Sweet Spot

Vídeos: 1; crescimento: +514321; primaryTopic: não separado no modelo anterior; entidades: nenhuma detectada; keywords: The Sweet Spot, sorveteria, sorvete, venda de sorvete.

- TÁ CALOR, ENTÃO EU COMECEI A VENDER SORVETE... DE MADRUGADA!
### 5. Roblox

Vídeos: 7; crescimento: +450503; primaryTopic: não separado no modelo anterior; entidades: Roblox; keywords: Roblox.

- ROUBANDO OVOS NO ROBLOX!
- TODOS OS SEGREDOS DESSA ATUALIZAÇÃO DO ROUBE UM OVO no ROBLOX!
- PEGAMOS OS NOVOS OVOS SECRETOS DO LEÃO GIGANTE DE CRISTAL!!
- ENCONTREI OVO SECRETO no BIOMA FLORESTA ENCANTADA do ROUBE UM OVO
- 🦋 NOVO BIOMA FLORESTA ENCANTADA NO ROUBE UM OVO DO ROBLOX! SEGREDOS E NOVIDADES!
- NOVA ATUALIZAÇÃO E BIOMA EM ROUBE UM OVO NO ROBLOX
- ROUBANDO OVOS NO ROBLOX...
### 6. Trailer de Vision Quest

Vídeos: 1; crescimento: +416199; primaryTopic: não separado no modelo anterior; entidades: nenhuma detectada; keywords: Vision Quest, Ultron, Marvel, Visão, Jocasta, Wanda.

- ULTRON ESCAPOU! É O FIM DO MUNDO? ANÁLISE COMPLETA DO TRAILER DE VISION QUEST
### 7. Minecraft

Vídeos: 8; crescimento: +401968; primaryTopic: não separado no modelo anterior; entidades: Minecraft; keywords: Minecraft, Sobrevivência, Roblox.

- CRIEI A DIMENSÃO QUE A MOJANG NÃO TEVE CORAGEM
- Sobrevivi Escondido na Civilização das Armaduras!
- Viramos uma FAMÍLIA DE VERITY no Minecraft!
- Fui MORDIDO por uma ARANHA e EVOLUÍ até o DEUS HOMEM- ARANHA no Minecraft! 🕷️😱
- GAROTA TITÃ APAIXONADA pelo GAROTO TITÃ
- Limpe Todas as Folhas em 1 Hora!
- Primeiro dia na ESCOLA de SUPER HEROI no Minecraft!
- MINI ESCONDE ESCONDE NO MINECRAFT
### 8. Minecraft

Vídeos: 2; crescimento: +333646; primaryTopic: não separado no modelo anterior; entidades: Minecraft; keywords: Minecraft, Gameplay.

- ADICIONEI MODS DE TERROR SEM CONTAR PARA MINHA AMIGA…
- A NOVA DIMENSÃO OFICIAL DO MINECRAFT: THE SIFT!
### 9. Se Cuida Aí

Vídeos: 1; crescimento: +265176; primaryTopic: não separado no modelo anterior; entidades: Se Cuida Aí; keywords: Se Cuida Aí, Sertanejo.

- Se Cuida Aí | Cleber & Cauan, Panda [ Resenha na Fazenda ]
### 10. Roblox

Vídeos: 3; crescimento: +262620; primaryTopic: não separado no modelo anterior; entidades: Roblox; keywords: Roblox.

- EU E MEU IRMÃOZINHO DORMIMOS NA CASA DA ÁRVORE COM NOSSAS NAMORADAS no BROOKHAVEN RP Roblox
- AJUDEI o SR ABOBORA do HALLOWEEN na NOVA ATUALIZAÇÃO do 99 NOITES NA FLORESTA 🎃🦇
- NUNCA ENTRE NA CASA DE DOCES DA BRUXA MALVADA (Escape Roblox)

## Top 10 — DEPOIS

### 1. Roblox

Vídeos: 24; crescimento: +1694057; primaryTopic: Roblox; entidades: Roblox, Roube um Ovo, Brookhaven; keywords: Roblox, Trailer, Gameplay, Roube um Ovo, Brookhaven.

- DEAD RAILS, ROBLOX NÃO DEVERIA SER TÃO DIFÍCIL!
- QUANDO SUA MONTARIA É A MAIS ÁGIL DE TODAS NO ROBLOX
- A NOVA ATUALIZAÇÃO VAI TE SURPREENDER EM BROOKHAVEN 
- Steal an Egg Bosses Characters in REAL LIFE!
- COMPREI OS BRINQUEDOS DO BROOKHAVEN NA VIDA REAL
- EU E MEU IRMÃOZINHO DORMIMOS NA CASA DA ÁRVORE COM NOSSAS NAMORADAS no BROOKHAVEN RP Roblox
- ABRI UM OVO E VEIO ISSO... 😱 MONTE UM PET NO ROBLOX!
- ROUBANDO OVOS NO ROBLOX!
- Steal an Egg But I Turned My Friends Into BOSSES!
- NOVA ATUALIZAÇÃO E BIOMA EM ROUBE UM OVO NO ROBLOX
- TODOS OS SEGREDOS DESSA ATUALIZAÇÃO DO ROUBE UM OVO no ROBLOX!
- PEGAMOS OS NOVOS OVOS SECRETOS DO LEÃO GIGANTE DE CRISTAL!!
- CRIEI MEU PRÓPRIO JOGO NO ROBLOX E SOU O ADM 😂
- ENCONTREI OVO SECRETO no BIOMA FLORESTA ENCANTADA do ROUBE UM OVO
- ESTOU VOLTANDO AO TOP GLOBAL DO ROUBE UM OVO FAZENDO ESSE MÉTODO SECRETO 🤫
- AJUDEI o SR ABOBORA do HALLOWEEN na NOVA ATUALIZAÇÃO do 99 NOITES NA FLORESTA 🎃🦇
- EU TESTEI A VERSÃO TERROR do ROBLOX…
- PASSEI A MADRUGADA NA FLORESTA ENCANTADA NO ROUBE UM OVO!
- ROUBANDO OVOS NO ROBLOX...
- ESTOU PRESA NESSA ESCOLA COM UM GATO CARTOLA... E ELE QUER ME PEGAR NO ROBLOX.
- LOKIS NO CAMINHO DO CARRO MALUCO | Roblox - Jeep Ride Into Toilet
- A Bizarre Run | Trailer 2 (SBR Game)
- 🦋 NOVO BIOMA FLORESTA ENCANTADA NO ROUBE UM OVO DO ROBLOX! SEGREDOS E NOVIDADES!
- NUNCA ENTRE NA CASA DE DOCES DA BRUXA MALVADA (Escape Roblox)
### 2. GTA 5

Vídeos: 3; crescimento: +1075384; primaryTopic: GTA 5; entidades: Batman, GTA 5, Homem-Aranha, Iron Man, Venom; keywords: GTA 5, Batman, Homem-Aranha, Iron Man, Venom.

- NUNCA tente se fingir de NPC no meio do trânsito...
- الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero
- الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero
### 3. Minecraft

Vídeos: 12; crescimento: +911514; primaryTopic: Minecraft; entidades: Minecraft, Homem-Aranha, família de Verity, civilização das armaduras; keywords: Minecraft, Gameplay, Sobrevivência, Roblox, sobrevivência, dimensões, Homem-Aranha, armaduras.

- CRIEI A DIMENSÃO QUE A MOJANG NÃO TEVE CORAGEM
- Sobrevivi Escondido na Civilização das Armaduras!
- Viramos uma FAMÍLIA DE VERITY no Minecraft!
- Virei PEQUENO no Esconde Esconde para Trollar!
- Fui MORDIDO por uma ARANHA e EVOLUÍ até o DEUS HOMEM- ARANHA no Minecraft! 🕷️😱
- ADICIONEI MODS DE TERROR SEM CONTAR PARA MINHA AMIGA…
- EU TENHO 0,0001% de CORAÇÃO!
- Limpe Todas as Folhas em 1 Hora!
- Primeiro dia na ESCOLA de SUPER HEROI no Minecraft!
- GAROTA TITÃ APAIXONADA pelo GAROTO TITÃ
- A NOVA DIMENSÃO OFICIAL DO MINECRAFT: THE SIFT!
- MINI ESCONDE ESCONDE NO MINECRAFT
### 4. Simone Mendes

Vídeos: 1; crescimento: +518389; primaryTopic: Simone Mendes; entidades: Simone Mendes; keywords: Simone Mendes.

- Simone Mendes - CÊ PERDEU (O MELHOR DE MIM)
### 5. The Sweet Spot

Vídeos: 1; crescimento: +514321; primaryTopic: The Sweet Spot; entidades: The Sweet Spot; keywords: The Sweet Spot.

- TÁ CALOR, ENTÃO EU COMECEI A VENDER SORVETE... DE MADRUGADA!
### 6. Vision Quest

Vídeos: 1; crescimento: +416199; primaryTopic: Vision Quest; entidades: Vision Quest, Marvel; keywords: Vision Quest, Marvel, Trailer.

- ULTRON ESCAPOU! É O FIM DO MUNDO? ANÁLISE COMPLETA DO TRAILER DE VISION QUEST
### 7. Cleber & Cauan

Vídeos: 1; crescimento: +265176; primaryTopic: Cleber & Cauan; entidades: Cleber & Cauan; keywords: Cleber & Cauan, Sertanejo.

- Se Cuida Aí | Cleber & Cauan, Panda [ Resenha na Fazenda ]
### 8. Call of Duty: Modern Warfare 4

Vídeos: 1; crescimento: +217808; primaryTopic: Call of Duty: Modern Warfare 4; entidades: DMZ, Activision; keywords: Call of Duty, Modern Warfare 4, DMZ, trailer, Worldbuilder.

- Call of Duty: Modern Warfare 4 | DMZ Worldbuilder Trailer
### 9. Deadlock

Vídeos: 1; crescimento: +198931; primaryTopic: Deadlock; entidades: Alanzoka, amigos, personagem principal; keywords: Deadlock, gameplay, Alanzoka, jogo com amigos, personagem principal.

- EM BUSCA DO MEU MAIN! - DEADLOCK COM OS AMIGOS
### 10. Tema não identificado

Vídeos: 2; crescimento: +192192; primaryTopic: não separado no modelo anterior; entidades: nenhuma detectada; keywords: .

- sobrevivendo ao NOVO CAT HAT com CHAT DE VOZ
- falar = SPAWNA BLOCOS E MOBS

## Verificação

- **67 testes, 11 suítes** passaram (npm run test:topics); provedores mockados. Cobrem aliases, Roblox, personagens vs assunto, assuntos diferentes com vetores semelhantes, tag/categoria insuficientes, pontes semânticas, artistas corroborados, fallback, unitário associado com ID preservado e unitário novo.
- Build Nest, ESLint dos TypeScript envolvidos e git diff --check passaram.
- PostgreSQL descartável: migrations, arrays/cache por hash/modelo, campos canônicos, transação/rollback, identidade, lock e uso separado passaram.
- HTTP/navegador: temas persistidos, soma 100000+200000+350000=650000, parâmetros, loading, períodos, detalhes, retry/erro/vazio e telas 1440/768/390 passaram.
- Histórico real desde o diagnóstico: 0 embeddings gerados; 6 chamadas de classificação, 21931 tokens. Na execução final e em worker novo após restart: zero chamadas LLM, zero embeddings gerados e 105 embeddings reutilizados.

## Arquivos desta correção

Alterados: trends/semantic/topic-entities.service.ts; topic-naming.service.ts; semantic-topics.processor.ts; semantic-topics.repository.ts; semantic-topic.interface.ts; semantic.spec.ts; semantic-topics.processor.spec.ts; src/sources/youtube/youtube-metrics.repository.ts; trends/trending-topics.service.ts e seu teste; trends/interfaces/trending-topic.interface.ts; scripts/migrate-youtube.cjs; scripts/process-semantic-topics.cjs; test/youtube/semantic-persistence.integration.cjs; test/youtube/topics-browser.integration.cjs; SEMANTIC_TOPICS_REPORT.md.

Criados: trends/semantic/topic-consolidation.ts e seu teste; migrations/003_canonical_topics.sql; scripts/diagnose-canonical-topics.cjs; scripts/process-canonical-topics.cjs; scripts/write-canonical-report.cjs; reports/canonical-before.json; reports/canonical-comparison.json; CANONICAL_TOPICS_REPORT.md.

## Limitações e operação

Ainda há dois temas sem identificação confiável, incluindo dois vídeos do canal Mendrux sem metadados suficientes para afirmar Roblox/Minecraft. Foram preservados. São 43 unitários, muitos com assunto real distinto. Catálogo e limites de consolidação precisam de avaliação em outras amostras. Tags genéricas, metadados incorretos e inferências do LLM podem produzir erros. Confidence estima evidência e não é uma probabilidade calibrada. Relações de franquia fora do catálogo podem continuar separadas. O worker refaz o agrupamento regional quando o texto muda, reutilizando embeddings/classificações; processamento incremental sofisticado ficou fora do escopo.

Migration e processamento da amostra já foram executados. Reinicie o backend para carregar o worker corrigido; os temas consolidados já estão persistidos. GET serve esse estado e as próximas coletas seguem o fluxo novo.
