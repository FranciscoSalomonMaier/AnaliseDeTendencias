import type {
  SubtitleSnapshot,
  SubtitleSettings,
  SubtitleSegment,
} from './subtitle.schema';
function clock(seconds: number, ass = false) {
  const units = Math.round(seconds * (ass ? 100 : 1000)),
    factor = ass ? 100 : 1000;
  const h = Math.floor(units / (3600 * factor)),
    m = Math.floor(units / (60 * factor)) % 60,
    s = Math.floor(units / factor) % 60,
    f = units % factor;
  return `${String(h).padStart(ass ? 1 : 2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${ass ? '.' : ','}${String(f).padStart(ass ? 2 : 3, '0')}`;
}
export function exportSrt(snapshot: SubtitleSnapshot) {
  return snapshot.segments
    .map(
      (s, i) =>
        `${i + 1}\n${clock(s.startSeconds)} --> ${clock(s.endSeconds)}\n${s.text
          .replace(/\r/g, '')
          .split('')
          .filter((c) => c === '\n' || c === '\t' || c.charCodeAt(0) >= 32)
          .join('')
          .replace(/\n{2,}/g, '\n')}\n`,
    )
    .join('\n');
}
export function escapeAss(text: string) {
  return text
    .replace(/\\/g, '＼')
    .replace(/{/g, '｛')
    .replace(/}/g, '｝')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\N')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('');
}
function color(value: string) {
  return `&H00${value.slice(5, 7)}${value.slice(3, 5)}${value.slice(1, 3)}`;
}
export function wrapSubtitle(text: string, s: SubtitleSettings) {
  const words = text.replace(/\s+/g, ' ').trim().split(' '),
    lines: string[] = [];
  let line = '';
  const maxCharacters = Math.min(
    s.maxCharacters,
    Math.floor(1800 / s.fontSize),
  );
  for (const word of words) {
    if (word.length > maxCharacters)
      throw Error(
        'Palavra excede a largura segura da legenda. Reduza a fonte ou revise o texto.',
      );
    if (line && line.length + word.length + 1 > maxCharacters) {
      lines.push(line);
      line = word;
    } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  if (lines.length > s.maxLines)
    throw Error(
      'Legenda excede o número máximo de linhas. Divida o segmento ou reduza o texto.',
    );
  return lines.join('\n');
}
export function exportAss(
  snapshot: SubtitleSnapshot,
  width: number,
  height: number,
) {
  const s = snapshot.settings,
    y = Math.round(
      Math.max(
        height * 0.05 + (s.fontSize * 1.3 * s.maxLines * height) / 1080,
        Math.min(
          height - (s.bottomMargin * height) / 1080,
          height * s.verticalPosition,
        ),
      ),
    );
  const fontSize = (s.fontSize * height) / 1080,
    outline = (s.outlineWidth * height) / 1080,
    shadow = (s.shadow * height) / 1080;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Liberation Sans,${fontSize},${color(s.textColor)},${color(s.highlightColor)},&H00000000,&H80000000,${s.preset === 'CLASSIC' ? 0 : -1},0,0,0,100,100,0,0,1,${outline},${shadow},2,60,60,${s.bottomMargin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const event = (
    segment: SubtitleSegment,
    start: number,
    end: number,
    text: string,
  ) =>
    `Dialogue: 0,${clock(start, true)},${clock(end, true)},Default,,0,0,0,,{\\an2\\pos(${Math.round(width / 2)},${y})}${text}`;
  const events: string[] = [];
  for (const seg of snapshot.segments) {
    const wrapped = wrapSubtitle(seg.text, s),
      words = seg.words;
    if (s.preset !== 'DYNAMIC' || !words?.length) {
      events.push(
        event(seg, seg.startSeconds, seg.endSeconds, escapeAss(wrapped)),
      );
      continue;
    }
    // Exact provider word intervals; gaps are unhighlighted. No interpolated karaoke times.
    let cursor = seg.startSeconds;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word.startSeconds > cursor)
        events.push(event(seg, cursor, word.startSeconds, escapeAss(wrapped)));
      const tokens = wrapped.split(/(\s+)/);
      let index = 0;
      const text = tokens
        .map((token) => {
          if (!token.trim()) return token.includes('\n') ? '\\N' : token;
          const n = index++;
          return n === i
            ? `{\\c${color(s.highlightColor)}&}${escapeAss(token)}{\\c${color(s.textColor)}&}`
            : escapeAss(token);
        })
        .join('');
      events.push(event(seg, word.startSeconds, word.endSeconds, text));
      cursor = word.endSeconds;
    }
    if (cursor < seg.endSeconds)
      events.push(event(seg, cursor, seg.endSeconds, escapeAss(wrapped)));
  }
  return header + events.join('\n') + '\n';
}
