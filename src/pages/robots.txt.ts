// robots.txt: адмінку не індексувати, де шукати карту сайту.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nDisallow: /admin/\n\nSitemap: ${new URL('sitemap-index.xml', site)}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
