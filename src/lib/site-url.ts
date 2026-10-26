// Astro.url.pathname already contains the configured base path.
export const getCanonicalURL = (
  pathname: string,
  site: URL | string
): string => {
  const url = new URL(pathname, site)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  url.search = ''
  url.hash = ''
  return url.toString()
}

const xmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export const escapeXML = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => xmlEntities[character])
