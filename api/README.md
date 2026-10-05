<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Análise com IA e PostgreSQL

`GET /trends/youtube/ai-analysis/latest?regionCode=BR` lê somente a última análise armazenada; não consulta YouTube ou OpenAI e retorna 404 se ela ainda não existir. `POST /trends/youtube/ai-analysis?regionCode=BR` coleta os dados atuais e reutiliza uma análise enquanto o fingerprint e o modelo forem iguais. `force=true` ignora o cache e pode consumir tokens. A análise salva permanece disponível até uma nova análise ser gerada ou removida explicitamente.

Os resultados e metadados ficam na tabela `ai_analyses`, criada na inicialização do backend, e sobrevivem ao reinício da aplicação no volume Docker. A data `expires_at` é mantida apenas como metadado de compatibilidade e não invalida mais os resultados. A proteção contra cliques simultâneos continua local à instância NestJS. Para múltiplas instâncias, adicione um lock distribuído (por exemplo, PostgreSQL advisory lock ou Redis) antes de chamar a IA.

## Geração de conteúdo narrado

O pipeline recebe o `id` de um cluster retornado por `GET /trends/youtube/grouped?regionCode=BR`. As etapas são independentes e usam `pt-BR` por padrão:

- `POST /trends/:trendId/content/ideas?regionCode=BR&language=pt-BR` gera 3 a 5 ideias. O corpo pode incluir `durationPreference` (`5-8`, `8-10` ou `10-15`) e `additionalInstructions`. Cada ideia retornada inclui `ideaId`, `generationId`, `trendId`, `regionCode` e `language` para continuar o fluxo.
- `GET /trends/content/:generationId` retoma snapshot, ideias, seleção, roteiro e plano salvos.
- `GET /trends/content?limit=50&offset=0&regionCode=BR` lista gerações paginadas; omita `regionCode` para consultar todas as regiões. A resposta inclui o snapshot do vídeo de referência, ideias, roteiro e cenas disponíveis para a Biblioteca do frontend.
- `GET /trends/content?limit=50&offset=0&regionCode=BR` lista as gerações salvas, inclusive roteiro e cenas, em páginas de até 100 registros. Omitir `regionCode` consulta todas as regiões.
- `PATCH /trends/content/:generationId/selection` recebe `{ "idea": <ideia retornada> }` e persiste a seleção.
- `POST /trends/content/script` recebe a ideia selecionada no corpo JSON e gera o roteiro narrado.
- `PATCH /trends/content/:generationId/script` recebe `{ "script": <roteiro editado> }` para salvar revisões sem consumir tokens.
- `POST /trends/content/scenes` recebe o roteiro retornado e gera cenas com descrições e prompts textuais. Nenhuma imagem é gerada.
- `PATCH /trends/content/:generationId/plan` recebe `{ "script": <roteiro>, "videoPlan": <plano revisado>, "approved": false }` para autosalvar cenas; `approved: true` registra a aprovação e libera a etapa visual de Produção. Nenhuma das operações consome tokens.
- `POST /trends/:trendId/content/plan?regionCode=BR&language=pt-BR` sem `selectedIdea` gera ideias; com `{ "selectedIdea": <ideia retornada> }` executa roteiro e cenas em sequência.

O snapshot da trend, as ideias, a escolha, o roteiro, o plano de cenas e os tokens usados são salvos em `content_generation_runs`. A tabela é criada com `CREATE TABLE IF NOT EXISTS`; nenhuma tabela ou dado existente é apagado. As etapas posteriores usam o snapshot persistido, não dependem de uma nova coleta de tendências. `provider`, `model` e os contadores cumulativos `input_tokens`, `output_tokens` e `total_tokens` ficam registrados por geração.

Os prompts vivem em `src/ai/content-generation/prompts/` e as saídas são validadas com Zod e Structured Outputs. O provider OpenAI é compartilhado com a análise de trends. Os testes usam mocks e não fazem chamadas externas.

No diretório `AnaliseTreads`, inicie o banco com `docker compose up -d postgres`. A API requer `DATABASE_URL` no seu `.env`; veja `.env.example`. O Compose publica o PostgreSQL local na porta `5433` para evitar conflito com outros serviços na porta padrão `5432`, e expõe essa porta somente em `127.0.0.1`. O Compose usa uma senha de **desenvolvimento local**. Antes de uso fora da máquina local, defina `POSTGRES_PASSWORD` no ambiente do Compose e use a mesma senha em `DATABASE_URL`; não versionar credenciais reais. O backend deve ser iniciado depois de o healthcheck do PostgreSQL ficar saudável.

Os testes de cache e orquestração usam `jest.ai-cache.config.cjs` para mapear os imports de `src/` e `trends/`.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
