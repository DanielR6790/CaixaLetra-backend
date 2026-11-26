// Extrai o ano de textos como "2019-05-24"
export function parseYear(value) {
  const match = /^(\d{4})/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

// Remove tags HTML de descrições (AniList costuma enviar <br>, <i> etc.)
export function stripHtml(text) {
  if (!text) return null;
  const clean = String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean || null;
}