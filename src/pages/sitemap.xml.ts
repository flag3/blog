import type { APIRoute } from 'astro'
import { getAllPosts } from '../lib/notion/client'
import { getNavLink, getPostLink } from '../lib/blog-helpers'
import { escapeXML, getCanonicalURL } from '../lib/site-url'

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('A site URL is required to generate the sitemap')
  const posts = await getAllPosts()
  const paths = [
    getNavLink('/'),
    ...posts.map((post) => getPostLink(post.Slug)),
  ]
  const urls = [...new Set(paths.map((path) => getCanonicalURL(path, site)))]
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map((url) => `  <url><loc>${escapeXML(url)}</loc></url>`)
        .join('\n') +
      '\n</urlset>\n',
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  )
}
