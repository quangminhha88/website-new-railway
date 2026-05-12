import type { Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { rateLimit } from '../lib/rateLimit.js';

// ── Vitals ────────────────────────────────────────────────────────────
const vitalSchema = z.object({
  name: z.enum(['LCP', 'FID', 'INP', 'CLS', 'TTFB', 'FCP']),
  value: z.number().min(0).max(60_000),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  pagePath: z.string().min(1).max(500),
  navigationType: z.string().optional(),
});

export async function vitalsHandler(req: Request, res: Response) {
  try {
    const parsed = vitalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
    const supabase = getSupabaseAdmin();
    void supabase.from('web_vitals').insert({
      name: parsed.data.name,
      value: parsed.data.value,
      rating: parsed.data.rating,
      page_path: parsed.data.pagePath,
      navigation_type: parsed.data.navigationType ?? null,
      created_at: new Date().toISOString(),
    });
  } catch { /* swallow */ }
  return res.status(204).end();
}

// ── Log Error ─────────────────────────────────────────────────────────
const errorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(20_000).optional(),
  componentStack: z.string().max(10_000).optional(),
  source: z.enum(['render', 'event', 'async', 'api', 'query']),
  url: z.string().max(2000).optional(),
  pagePath: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  visitorId: z.string().max(100).optional(),
  appVersion: z.string().max(50).optional(),
  environment: z.enum(['development', 'preview', 'production']).optional(),
  context: z.record(z.unknown()).optional(),
  fingerprint: z.string().max(100).optional(),
});

export async function logErrorHandler(req: Request, res: Response) {
  try {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await rateLimit(`err:${ip}`, 30, 60);
    if (!allowed) return res.status(204).end();

    const parsed = errorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(204).end();

    const supabase = getSupabaseAdmin();
    void supabase.from('error_logs').insert({
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      component_stack: parsed.data.componentStack ?? null,
      source: parsed.data.source,
      url: parsed.data.url ?? null,
      page_path: parsed.data.pagePath ?? null,
      user_agent: parsed.data.userAgent ?? null,
      visitor_id: parsed.data.visitorId ?? null,
      app_version: parsed.data.appVersion ?? null,
      environment: parsed.data.environment ?? 'production',
      context: parsed.data.context ?? null,
      fingerprint: parsed.data.fingerprint ?? null,
    });
  } catch { /* swallow */ }
  return res.status(204).end();
}

// ── SEO Tools ─────────────────────────────────────────────────────────
const SITE_URL = process.env.APP_URL || 'https://saas-excellence.com';

export async function seoToolsHandler(_req: Request, res: Response) {
  try {
    const supabase = getSupabaseAdmin();
    const { data: tools, error } = await supabase
      .from('tools')
      .select('slug, name, description, tagline, updated_at, category_id, categories(name)')
      .order('updated_at', { ascending: false })
      .limit(1000);

    if (error) return res.status(500).json({ error: 'Failed to load tools', detail: error.message });

    const feed = (tools ?? []).map((t: any) => ({
      slug: t.slug,
      name: t.name,
      url: `${SITE_URL}/tools/${t.slug}`,
      description: t.tagline || t.description,
      category: t.categories?.name ?? null,
      lastModified: t.updated_at ?? new Date().toISOString(),
    }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.status(200).json({ count: feed.length, tools: feed });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

// ── SEO Track ─────────────────────────────────────────────────────────
const trackSchema = z.object({
  type: z.enum(['impression', 'dwell', 'affiliate_click']),
  pagePath: z.string().min(1).max(500),
  pageType: z.enum(['tool', 'niche', 'comparison', 'category', 'home', 'other']).default('other'),
  variantIndex: z.number().int().min(0).max(20).optional(),
  resourceSlug: z.string().min(1).max(200).optional(),
  durationMs: z.number().int().min(0).max(60 * 60 * 1000).optional(),
  targetSlug: z.string().min(1).max(200).optional(),
  visitorId: z.string().min(8).max(64),
  referrer: z.string().max(500).optional(),
  timestamp: z.number().int().positive().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function seoTrackHandler(req: Request, res: Response) {
  try {
    const result = trackSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'invalid_payload' });
    const parsed = result.data;
    const supabase = getSupabaseAdmin();
    void supabase.from('seo_metrics').insert({
      event_type: parsed.type,
      page_path: parsed.pagePath,
      page_type: parsed.pageType,
      variant_index: parsed.variantIndex ?? null,
      resource_slug: parsed.resourceSlug ?? null,
      duration_ms: parsed.durationMs ?? null,
      target_slug: parsed.targetSlug ?? null,
      visitor_id: parsed.visitorId,
      referrer: parsed.referrer ?? null,
      meta: parsed.meta ?? null,
      created_at: new Date(parsed.timestamp ?? Date.now()).toISOString(),
    });
  } catch { /* swallow */ }
  return res.status(204).end();
}
