import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const APP_URL = process.env.APP_URL ?? 'https://saas-excellence.com';

interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => `
  <url>
    <loc>${APP_URL}${e.url}</loc>
    ${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}
    ${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ''}
    ${e.priority != null ? `<priority>${e.priority}</priority>` : ''}
  </url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`;
}

const STATIC_PAGES: SitemapEntry[] = [
  { url: '/', priority: 1.0, changefreq: 'daily' },
  { url: '/finder', priority: 0.9, changefreq: 'weekly' },
];

export async function sitemapHandler(_req: Request, res: Response) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).send('Sitemap not configured');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const entries: SitemapEntry[] = [...STATIC_PAGES];

    const [toolsRes, catsRes, nichesRes] = await Promise.all([
      supabase.from('tools').select('slug, updated_at').eq('moderation_status', 'approved'),
      supabase.from('categories').select('slug, updated_at'),
      supabase.from('niche_pages').select('slug, created_at'),
    ]);

    for (const t of toolsRes.data ?? []) {
      entries.push({ url: `/tools/${t.slug}`, lastmod: t.updated_at?.slice(0, 10), priority: 0.8, changefreq: 'weekly' });
    }
    for (const c of catsRes.data ?? []) {
      entries.push({ url: `/category/${c.slug}`, lastmod: c.updated_at?.slice(0, 10), priority: 0.7, changefreq: 'weekly' });
    }
    for (const n of nichesRes.data ?? []) {
      entries.push({ url: `/best/${n.slug}`, lastmod: n.created_at?.slice(0, 10), priority: 0.7, changefreq: 'weekly' });
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
    return res.status(200).send(buildSitemapXml(entries));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).send(`Sitemap generation failed: ${msg}`);
  }
}
