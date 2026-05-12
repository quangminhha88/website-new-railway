import type { Request, Response } from 'express';

const APP_URL = process.env.APP_URL ?? 'https://saas-excellence.com';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function fetchSupabase(table: string, filter: string, select: string) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&select=${select}&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) return null;
    const rows = await res.json() as any[];
    return rows[0] ?? null;
  } catch { return null; }
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
}

function buildSvg(content: string): string {
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="white"/>
  <rect x="0" y="626" width="1200" height="4" fill="#4f46e5"/>
  ${content}
  <text x="1150" y="610" font-family="Arial,sans-serif" font-size="22" fill="#9ca3af" text-anchor="end" font-weight="600">${APP_URL.replace(/^https?:\/\//, '')}</text>
</svg>`;
}

// ── OG Tool ───────────────────────────────────────────────────────────
export async function ogToolHandler(req: Request, res: Response) {
  const slug = String(req.query.slug ?? '');
  const tool = slug ? await fetchSupabase('tools', `slug=eq.${encodeURIComponent(slug)}`, 'name,tagline,avg_rating,review_count,pricing_model') : null;

  const name = tool?.name ?? 'SaaS Excellence Hub';
  const tagline = tool?.tagline ?? '';
  const initial = name[0].toUpperCase();

  const content = `
  <rect x="70" y="70" width="80" height="80" rx="16" fill="#4f46e5"/>
  <text x="110" y="128" font-family="Arial,sans-serif" font-size="44" fill="white" text-anchor="middle" font-weight="800">${initial}</text>
  <text x="170" y="118" font-family="Arial,sans-serif" font-size="48" fill="#111827" font-weight="800">${truncate(name, 30)}</text>
  ${tagline ? `<text x="170" y="155" font-family="Arial,sans-serif" font-size="24" fill="#6b7280">${truncate(tagline, 60)}</text>` : ''}
  ${tool?.avg_rating != null ? `<text x="70" y="530" font-family="Arial,sans-serif" font-size="28" fill="#111827" font-weight="600">★ ${tool.avg_rating}${tool.review_count ? ` (${tool.review_count} reviews)` : ''}</text>` : ''}
  ${tool?.pricing_model ? `<rect x="70" y="550" width="160" height="44" rx="22" fill="#dbeafe"/><text x="150" y="578" font-family="Arial,sans-serif" font-size="22" fill="#1e40af" text-anchor="middle" font-weight="600">${tool.pricing_model}</text>` : ''}`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  return res.status(200).send(buildSvg(content));
}

// ── OG Niche ──────────────────────────────────────────────────────────
export async function ogNicheHandler(req: Request, res: Response) {
  const slug = String(req.query.slug ?? '');
  const niche = slug ? await fetchSupabase('niche_pages', `slug=eq.${encodeURIComponent(slug)}`, 'niche_name,seo_title,seo_meta_description') : null;

  const heading = niche?.niche_name ?? 'Best SaaS Tools Guide';
  const subtitle = niche?.seo_meta_description ?? 'Curated picks, real testing, honest verdicts.';

  const content = `
  <rect x="70" y="70" width="80" height="80" rx="20" fill="#fef3c7"/>
  <text x="110" y="128" font-family="Arial,sans-serif" font-size="48" text-anchor="middle">🏆</text>
  <text x="170" y="118" font-family="Arial,sans-serif" font-size="22" fill="#4f46e5" font-weight="700">BEST TOOLS GUIDE</text>
  <text x="70" y="280" font-family="Arial,sans-serif" font-size="40" fill="#111827" font-weight="800">${truncate(heading, 60)}</text>
  <text x="70" y="340" font-family="Arial,sans-serif" font-size="24" fill="#6b7280">${truncate(subtitle, 80)}</text>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  return res.status(200).send(buildSvg(content));
}
