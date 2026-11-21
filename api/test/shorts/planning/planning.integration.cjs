/* Run after npm run build. Synthetic JSON only: no media execution or external calls. */
const assert = require('node:assert/strict');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const root = join(__dirname, '../../..', 'dist/src/short-creation/planning');
const { EditorialPlanningService } = require(join(root, 'planning.service'));
const { SimulatedPlanningAdapter } = require(join(root, 'planning-ai.adapter'));
const {
  fixtureInput,
  fixturePlan,
  fixtureProviderResponse,
  fixtureCapabilities,
} = require(join(root, 'planning.fixtures'));
const { planningModelResponseSchema, planningProviderResponseSchema } = require(
  join(root, 'planning-model.schema'),
);
const { buildPlanningContext } = require(join(root, 'planning-context'));
const { buildPlanningPrompt } = require(join(root, 'planning-prompt'));
(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trends-planning-'));
  const authority = {
    authorizedAssetIds: new Set(['video1', 'music1', 'effect1', 'voice1']),
    capabilities: fixtureCapabilities,
  };
  const report = {
    contractVersion: 1,
    mode: 'SIMULATED',
    resources: fixtureCapabilities.length,
    scenarios: [],
    externalCalls: 0,
    renderedFiles: 0,
  };
  for (const name of [
    'ranking',
    'narrated',
    'gameplay',
    'horror',
    'insufficient',
  ]) {
    const input = fixtureInput(name),
      fixture = fixturePlan(name),
      context = buildPlanningContext(input, authority);
    const before = JSON.stringify(input),
      started = performance.now();
    const result = await new EditorialPlanningService(
      new SimulatedPlanningAdapter(fixture),
      authority,
    ).plan(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(JSON.stringify(input), before);
    assert.equal(result.validation.visual.frames, 180);
    assert.equal(result.validation.audio.duration, 6);
    assert.equal(result.validation.audio.sampleRate, 48000);
    assert.equal(result.compatibility.productionEnabled, false);
    assert.equal(JSON.stringify(result).includes('filterGraph'), false);
    planningModelResponseSchema.parse(fixture);
    if (name === 'ranking') assert.equal(context.knowledge.guidance.length, 63);
    if (name === 'insufficient')
      assert.ok(
        result.validation.diagnostics.some(
          (d) => d.code === 'NO_SEMANTIC_OBSERVATIONS',
        ),
      );
    const prompt = buildPlanningPrompt(context);
    await writeFile(
      join(directory, `${name}.input.json`),
      JSON.stringify(input, null, 2),
    );
    await writeFile(
      join(directory, `${name}.plan.json`),
      JSON.stringify(result, null, 2),
    );
    report.scenarios.push({
      name,
      valid: true,
      elapsedMs: performance.now() - started,
      knowledge: context.knowledge.knowledgeStatus,
      promptBytes: Buffer.byteLength(prompt.userPrompt),
      diagnostics: result.validation.diagnostics,
    });
  }
  const { zodTextFormat } = await import('openai/helpers/zod.mjs');
  const wire = zodTextFormat(
    planningProviderResponseSchema,
    'short_editorial_plan_v1',
  );
  assert.equal(wire.strict, true);
  const parsedWire = wire.$parseRaw(
    JSON.stringify(fixtureProviderResponse(fixturePlan())),
  );
  assert.ok(parsedWire);
  await writeFile(
    join(directory, 'provider-schema.json'),
    JSON.stringify(wire, null, 2),
  );
  const invalid = fixturePlan();
  invalid.visualOperations[0].usage.parameters.filter = 'arbitrary';
  const rejected = await new EditorialPlanningService(
    new SimulatedPlanningAdapter(invalid),
    authority,
  ).plan(fixtureInput());
  assert.equal(rejected.ok, false);
  await writeFile(
    join(directory, 'invalid.plan.json'),
    JSON.stringify({ input: invalid, result: rejected }, null, 2),
  );
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      directory,
      scenarios: report.scenarios.length,
      providerSchemaConverted: true,
      externalCalls: 0,
      renderedFiles: 0,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
