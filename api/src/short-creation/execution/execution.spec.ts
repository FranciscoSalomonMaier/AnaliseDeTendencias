jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureInput, fixturePlan } from '../planning/planning.fixtures';
import { EditingPlanExecutor } from './execution.service';
import {
  executionInputSchema,
  executionLimitsSchema,
} from './execution.schema';
import { snapshotSource } from './execution-source-resolver';
import { compareVideoMetadata, readVideoMetadata } from './execution-preflight';
import { validateExecutionOutput } from './execution-output-validator';
import {
  compileExecutionVisual,
  compileExecutionGraph,
} from './execution-compiler';
import { fixtureCapabilities } from '../planning/planning.fixtures';
const settings = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  tempDir: '/tmp/execution-tests-unused',
  sourceRoot: '/tmp/execution-tests-unused',
};
const authority = {
  authorizedAssetIds: new Set(['video1', 'music1', 'effect1', 'voice1']),
  resolve: jest.fn(),
};
const input = () => ({
  version: 1,
  executionId: 'test-execution',
  context: fixtureInput('insufficient'),
  plan: fixturePlan('insufficient'),
});
describe('Isolated execution contracts and rejection', () => {
  test('accepts real stage9 envelope without trusting a validated marker', () => {
    expect(executionInputSchema.safeParse(input()).success).toBe(true);
    expect(
      executionInputSchema.safeParse({ ...input(), validated: true }).success,
    ).toBe(false);
  });
  test.each([0, 2, -1])(
    'rejects execution version %s before subprocesses',
    async (version) => {
      const run = jest.fn(),
        executor = new EditingPlanExecutor({ run } as never, settings);
      const result = await executor.execute({ ...input(), version }, authority);
      expect(result.status).toBe('FAILED');
      expect(result.diagnostics[0].code).toBe('VERSION_UNSUPPORTED');
      expect(run).not.toHaveBeenCalled();
    },
  );
  test.each(['version', 'libraryVersion'])(
    'rejects incompatible plan %s',
    async (field) => {
      const run = jest.fn(),
        raw = input();
      (raw.plan as any)[field] = 99;
      const result = await new EditingPlanExecutor(
        { run } as never,
        settings,
      ).execute(raw, authority);
      expect(result.status).toBe('FAILED');
      expect(run).not.toHaveBeenCalled();
    },
  );
  test.each([
    [
      'unknown resource',
      (p: any) => (p.visualOperations[0].usage.resourceId = 'UNKNOWN'),
    ],
    [
      'unknown parameter',
      (p: any) =>
        (p.visualOperations[0].usage.parameters.filter = 'movie=/secret'),
    ],
    ['shell identifier', (p: any) => (p.clips[0].sourceId = '$(touch hacked)')],
    [
      'external URL',
      (p: any) => (p.clips[0].sourceId = 'https://example.com/v.mp4'),
    ],
    ['absolute path', (p: any) => (p.clips[0].sourceId = '/tmp/a.mp4')],
    ['invalid duration', (p: any) => (p.durationSeconds = -1)],
    [
      'missing dependency',
      (p: any) => (p.visualOperations[0].usage.target.sourceId = 'missing'),
    ],
    [
      'cycle',
      (p: any) =>
        p.visualOperations.push({
          id: 'cycle',
          usage: {
            contractVersion: 1,
            resourceId: 'CONCAT',
            resourceVersion: 1,
            target: { scope: 'COMPOSITION', clipIds: ['clip1', 'clip1'] },
            parameters: {},
          },
          reason: 'Teste',
          observationIds: [],
        }),
    ],
    [
      'operation limit',
      (p: any) => (p.visualOperations = Array(13).fill(p.visualOperations[0])),
    ],
  ] as const)('rejects %s before execution', async (_label, mutate) => {
    const run = jest.fn(),
      raw = input();
    mutate(raw.plan);
    const result = await new EditingPlanExecutor(
      { run } as never,
      settings,
    ).execute(raw, authority);
    expect(result.status).toBe('FAILED');
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('/secret');
  });
  test('unauthorized source prevents probing and resolving files', async () => {
    const run = jest.fn(),
      resolve = jest.fn();
    const result = await new EditingPlanExecutor(
      { run } as never,
      settings,
    ).execute(input(), { authorizedAssetIds: new Set(), resolve });
    expect(result.status).toBe('FAILED');
    expect(run).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
  test('without narration rejects NARRATION before any subprocess', async () => {
    const raw = input();
    raw.plan.audioOperations = [
      {
        id: 'voice',
        usage: {
          contractVersion: 1,
          resourceId: 'NARRATION',
          resourceVersion: 1,
          target: { scope: 'COMPOSITION', clipId: 'voice' },
          parameters: {
            clipId: 'voice1',
            sourceId: 'voice1',
            sourceStart: 0,
            sourceEnd: 6,
          },
        },
        reason: 'Teste',
        observationIds: [],
      },
    ];
    const run = jest.fn();
    expect(
      (
        await new EditingPlanExecutor({ run } as never, settings).execute(
          raw,
          authority,
        )
      ).status,
    ).toBe('FAILED');
    expect(run).not.toHaveBeenCalled();
  });
  test('pre-cancellation never spawns processes', async () => {
    const c = new AbortController();
    c.abort();
    const run = jest.fn();
    const result = await new EditingPlanExecutor(
      { run } as never,
      settings,
    ).execute(input(), authority, c.signal);
    expect(result.status).toBe('CANCELLED');
    expect(run).not.toHaveBeenCalled();
  });
  test('limits can be tightened but never increased', () => {
    expect(executionLimitsSchema.parse({})).toEqual({
      timeoutMs: 120000,
      outputBytes: 128 * 1024 ** 2,
    });
    for (const invalid of [
      { timeoutMs: 120001 },
      { timeoutMs: 0 },
      { outputBytes: 128 * 1024 ** 2 + 1 },
    ])
      expect(executionLimitsSchema.safeParse(invalid).success).toBe(false);
  });
  test('compiler preserves stage9 clocks and maps original audio to existing visual input', () => {
    const p = fixturePlan('gameplay'),
      context = fixtureInput('gameplay');
    const visual = compileExecutionVisual(
        p as never,
        context,
        fixtureCapabilities,
      ),
      graph = compileExecutionGraph(visual, [], p as never, context);
    expect(visual.expectedDuration).toBe(6);
    expect(graph.additionalAudioIds).toEqual([]);
    expect(graph.filterGraph).toContain('[0:a:0]');
    expect(graph.audioLabel).toMatch(/^exec_a/);
  });
  test('empty audio timeline creates no stream or artificial audio graph', () => {
    const raw = input(),
      visual = compileExecutionVisual(
        raw.plan as never,
        raw.context,
        fixtureCapabilities,
      ),
      graph = compileExecutionGraph(visual, [], raw.plan as never, raw.context);
    expect(graph.audio).toBeNull();
    expect(graph.audioLabel).toBeNull();
    expect(graph.filterGraph).not.toContain('anullsrc');
  });
});
const videoProbe = () => ({
  format: { duration: '6' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      width: 1280,
      height: 720,
      avg_frame_rate: '30/1',
      start_time: '0',
      duration: '6',
      nb_read_frames: '180',
      sample_aspect_ratio: '1:1',
    },
  ],
});
describe('Preflight and final metadata', () => {
  test('supports silence without requiring audio metadata', () =>
    expect(readVideoMetadata(videoProbe()).hasAudio).toBe(false));
  test.each(['duration', 'width', 'fps', 'hasAudio', 'videoCodec'] as const)(
    'detects changed %s',
    (field) => {
      const actual = readVideoMetadata(videoProbe()),
        expected = fixtureInput().videos[0];
      expected.metadata.duration = 6;
      expected.hasAudio = false;
      delete expected.audio;
      expected.codec = 'h264';
      if (field === 'duration') actual.duration = 7;
      else if (field === 'width') actual.width = 640;
      else if (field === 'fps') actual.fps = 25;
      else if (field === 'hasAudio') actual.hasAudio = true;
      else actual.videoCodec = 'vp9';
      expect(() => compareVideoMetadata(actual, expected)).toThrow();
    },
  );
  test('rejects non-square pixels and rotation instead of remapping silently', () => {
    const p = videoProbe();
    p.streams[0].sample_aspect_ratio = '4:3';
    expect(() => readVideoMetadata(p)).toThrow();
    p.streams[0].sample_aspect_ratio = '1:1';
    (p.streams[0] as any).side_data_list = [{ rotation: 90 }];
    expect(() => readVideoMetadata(p)).toThrow();
  });
  test('rejects unknown timestamps and ambiguous video/audio streams', () => {
    const p = videoProbe();
    p.streams[0].start_time = 'N/A';
    expect(() => readVideoMetadata(p)).toThrow();
    p.streams[0].start_time = '0';
    p.streams.push(p.streams[0]);
    expect(() => readVideoMetadata(p)).toThrow();
  });
});
describe('Authorized snapshot and output verification', () => {
  let root: string, workspace: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'execution-unit-'));
    workspace = join(root, 'workspace');
    await mkdir(workspace);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  test('copies authorized bytes without chmod or modification of original', async () => {
    const path = join(root, 'original.mp4');
    await writeFile(path, 'synthetic', { mode: 0o644 });
    const before = await stat(path);
    const result = await snapshotSource(
      'video1',
      root,
      workspace,
      { authorizedAssetIds: new Set(['video1']), resolve: async () => path },
      new AbortController().signal,
      'VIDEO',
    );
    expect(await readFile(result.path, 'utf8')).toBe('synthetic');
    expect(result.sha256).toHaveLength(64);
    expect((await stat(path)).mode).toBe(before.mode);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });
  test('symlink escaping authorized root is rejected', async () => {
    const path = join(root, 'link.mp4');
    await symlink('/etc/hosts', path);
    await expect(
      snapshotSource(
        'video1',
        root,
        workspace,
        { authorizedAssetIds: new Set(['video1']), resolve: async () => path },
        new AbortController().signal,
        'VIDEO',
      ),
    ).rejects.toThrow('raiz');
  });
  test('unauthorized lookup and pre-aborted copy never open a source', async () => {
    const resolve = jest.fn();
    await expect(
      snapshotSource(
        'video1',
        root,
        workspace,
        { authorizedAssetIds: new Set(), resolve },
        new AbortController().signal,
        'VIDEO',
      ),
    ).rejects.toThrow('autorizada');
    expect(resolve).not.toHaveBeenCalled();
  });
  test('output requires expected frame count, not only successful exit', async () => {
    const path = join(workspace, 'output.mp4');
    await writeFile(path, 'dummy');
    const raw = videoProbe();
    raw.streams[0].nb_read_frames = '179';
    const run = jest.fn().mockResolvedValue(JSON.stringify(raw));
    await expect(
      validateExecutionOutput(
        { run } as never,
        settings,
        path,
        {
          duration: 6,
          frames: 180,
          width: 1280,
          height: 720,
          hasAudio: false,
          maxBytes: 1024,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('frames');
  });
  test('over-limit output rejected before probe', async () => {
    const path = join(workspace, 'output.mp4');
    await writeFile(path, Buffer.alloc(1024));
    const run = jest.fn();
    await expect(
      validateExecutionOutput(
        { run } as never,
        settings,
        path,
        {
          duration: 6,
          frames: 180,
          width: 1280,
          height: 720,
          hasAudio: false,
          maxBytes: 1024,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('limite');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Concurrency, deadlines and timestamp assumptions', () => {
  test('only one execution can own the isolated process budget', async () => {
    let release: () => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = () => resolve('');
    });
    const run = jest.fn().mockReturnValue(gate),
      executor = new EditingPlanExecutor({ run } as never, settings);
    const first = executor.execute(input(), authority);
    const second = await new EditingPlanExecutor(
      { run } as never,
      settings,
    ).execute(input(), authority);
    expect(second.status).toBe('FAILED');
    expect(second.diagnostics[0].code).toBe('EXECUTOR_BUSY');
    release();
    expect((await first).status).toBe('FAILED');
  });
  test('rejects VFR metadata instead of inventing a CFR timeline', () => {
    const p = videoProbe();
    (p.streams[0] as any).r_frame_rate = '60/1';
    expect(() => readVideoMetadata(p)).toThrow('variável');
  });
});
