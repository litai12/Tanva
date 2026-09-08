// Display-only conversion. Never write the temporary object URL back to a log.
export function resolveLogImageSource(input) {
  const source = typeof input === 'string' ? input.trim() : '';
  if (!source) return { url: '', release: () => {} };
  if (
    /^(https?:\/\/|blob:|\/[^/])/i.test(source) &&
    !source.startsWith('/9j/')
  ) {
    return { url: source, release: () => {} };
  }
  const data = source.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i);
  const rawMime = source.startsWith('iVBORw0')
    ? 'image/png'
    : source.startsWith('/9j/')
      ? 'image/jpeg'
      : source.startsWith('R0lGOD')
        ? 'image/gif'
        : source.startsWith('UklGR')
          ? 'image/webp'
          : '';
  if (!data && !rawMime) return { url: '', release: () => {} };
  try {
    const decoded = atob((data ? data[2] : source).replace(/\s/g, ''));
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: data ? data[1] : rawMime }),
    );
    return { url, release: () => URL.revokeObjectURL(url) };
  } catch {
    return { url: '', release: () => {} };
  }
}
