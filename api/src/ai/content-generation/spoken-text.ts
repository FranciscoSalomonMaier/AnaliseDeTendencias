// Only remove explicit bracketed production directions. Descriptions that are
// part of the story, and ordinary bracketed quotes, remain spoken text.
const visualDirection =
  /^(?:imagem\b|image\b|visual\s*:|descri[cç][aã]o\s+(?:visual|da imagem)\b|prompt\b|corte(?:\s+(?:para|de)|\s*:)|cut\b|c[aâ]mera\s*:|camera\s*:|enquadramento\s*:|shot\s*:)/i;
export function hasVisualDirections(text: string) {
  return [...text.matchAll(/\[([^[\]]*)\]/g)].some((match) =>
    visualDirection.test(match[1].trim()),
  );
}
export function spokenText(text: string) {
  if (!hasVisualDirections(text)) return text.trim();
  return text
    .replace(/\[([^[\]]*)\]/g, (original: string, content: string) =>
      visualDirection.test(content.trim()) ? '' : original,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .trim();
}
