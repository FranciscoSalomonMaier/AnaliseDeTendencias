export function youtubeIdFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const u = new URL(value);
    let id: string | null = null;
    if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)
    ) {
      id =
        u.pathname === '/watch'
          ? u.searchParams.get('v')
          : (u.pathname.match(
              /^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/,
            )?.[1] ?? null);
    } else if (u.hostname === 'youtu.be')
      id = u.pathname.slice(1).split('/')[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function sourceUrl(value: string) {
  const id = youtubeIdFromUrl(value);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const u = new URL(value);
  u.hash = '';
  return u.toString();
}
