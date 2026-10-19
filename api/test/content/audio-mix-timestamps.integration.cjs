// Real FFmpeg regression: concat timestamp gaps must survive a PCM WAV mix.
// Synthetic local tones only; no database, project mutations or paid calls.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static'),
  ffprobe = require('ffprobe-static').path;
const {
  AudioMixService,
} = require('../../dist/src/content-audio/audio-mix.service');
const {
  defaultProjectAudio,
} = require('../../dist/src/content-audio/project-audio.schema');
const root = mkdtempSync('/tmp/trends-mix-timestamps-'),
  duration = 160 / 30,
  total = 3 * duration;
function run(binary, args) {
  const r = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}
for (let i = 0; i < 3; i++)
  run(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${440 + i * 110}:sample_rate=48000:duration=${duration}`,
    '-af',
    'aformat=channel_layouts=stereo,asetpts=PTS+0.2/TB',
    '-t',
    String(duration),
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    join(root, `scene-${i}.mkv`),
  ]);
writeFileSync(
  join(root, 'concat.txt'),
  Array.from(
    { length: 3 },
    (_, i) => `file 'scene-${i}.mkv'\nduration ${duration}`,
  ).join('\n'),
);
const music = join(root, 'music.wav');
run(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=180:sample_rate=48000:duration=2',
  '-c:a',
  'pcm_s16le',
  music,
]);
const settings = {
  ...defaultProjectAudio(),
  backgroundMusicAssetId: 'music',
  musicVolume: 0.15,
  musicFadeInSeconds: 0,
  musicFadeOutSeconds: 0,
};
const graph = new AudioMixService().build(
  { settings, music: { assetId: 'music', durationSeconds: 2 }, effects: [] },
  total,
  [{ assetId: 'music', path: music }],
);
function mix(name, filters) {
  const output = join(root, name + '.wav');
  run(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-filter_complex_threads',
    '1',
    '-f',
    'concat',
    '-safe',
    '1',
    '-i',
    join(root, 'concat.txt'),
    ...graph.inputArgs,
    '-filter_complex',
    filters,
    '-map',
    graph.map,
    '-c:a',
    'pcm_s16le',
    '-t',
    String(total),
    output,
  ]);
  const probe = JSON.parse(
    run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', output]),
  );
  return { output, duration: Number(probe.format.duration) };
}
const legacy = mix(
  'legacy',
  graph.filters.replace(
    'aresample=48000:async=1:first_pts=0',
    'aresample=48000',
  ),
);
assert.ok(
  total - legacy.duration > 0.15,
  `Fixture must reproduce lost timestamp gaps: ${legacy.duration} vs ${total}`,
);
const corrected = mix('corrected', graph.filters);
assert.ok(
  Math.abs(corrected.duration - total) < 1 / 48000,
  `${corrected.duration} vs ${total}`,
);
const pcm = join(root, 'decoded.f32');
run(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-i',
  corrected.output,
  '-af',
  'pan=mono|c0=c0',
  '-c:a',
  'pcm_f32le',
  '-f',
  'f32le',
  pcm,
]);
const bytes = readFileSync(pcm),
  samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
function amplitude(at, frequency) {
  const start = Math.round(at * 48000),
    count = 4800;
  let re = 0,
    im = 0;
  for (let i = 0; i < count; i++) {
    const value = samples[start + i],
      phase = (2 * Math.PI * frequency * i) / 48000;
    re += value * Math.cos(phase);
    im += value * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / count;
}
for (let i = 0; i < 3; i++) {
  assert.ok(
    amplitude((i + 1) * duration - 0.15, 440 + i * 110) < 0.001,
    'Gap must remain silent in the narration',
  );
  assert.ok(
    amplitude(i * duration + 0.5, 440 + i * 110) > 0.02,
    'Voice must retain its timeline position',
  );
}
assert.ok(
  amplitude(total - 0.5, 180) > 0.001,
  'Looped music must remain present near the end',
);
const video = join(root, 'corrected.mp4');
run(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  `color=c=black:s=640x360:r=30:d=${total}`,
  '-i',
  corrected.output,
  '-map',
  '0:v:0',
  '-map',
  '1:a:0',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-threads',
  '2',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-t',
  String(total),
  video,
]);
const finalProbe = JSON.parse(
  run(ffprobe, [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    video,
  ]),
);
assert.equal(
  finalProbe.streams.find((s) => s.codec_type === 'video').codec_name,
  'h264',
);
const finalAudio = finalProbe.streams.find((s) => s.codec_type === 'audio');
assert.equal(finalAudio.codec_name, 'aac');
assert.ok(Math.abs(Number(finalAudio.duration) - total) < 0.03);
assert.ok(Math.abs(Number(finalProbe.format.duration) - total) < 0.03);
console.log(
  JSON.stringify({
    status: 'PASS',
    expectedSeconds: total,
    legacySeconds: legacy.duration,
    correctedSeconds: corrected.duration,
    coverage:
      'Real concat timestamp gaps, complete WAV duration, scene narration positions, music loop/ducking through the end',
    directory: root,
  }),
);
