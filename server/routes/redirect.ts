import type { Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';

const slugSchema = z.string().regex(/^[a-z0-9-]+$/).max(120);
const sourceSchema = z.string().regex(/^[a-z0-9_-]*$/i).max(50).default('direct');

export async function redirectHandler(req: Request, res: Response) {
  const slugResult = slugSchema.safeParse(req.params.slug);
  if (!slugResult.success) return res.status(400).json({ error: 'invalid_slug' });
  const slug = slugResult.data;

  const sourceResult = sourceSchema.safeParse(req.query.src ?? 'direct');
  const source = sourceResult.success ? sourceResult.data : 'direct';

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  const ua = (req.headers['user-agent'] as string)?.slice(0, 500) || 'unknown';

  try {
    const supabase = getSupabaseAdmin();
    const { data: tool } = await supabase
      .from('tools')
      .select('id, slug, affiliate_url, website_url, fallback_url')
      .eq('slug', slug)
      .single();

    const destination = tool?.affiliate_url || tool?.website_url || tool?.fallback_url;

    if (!destination) {
      return res.redirect(302, '/');
    }

    try {
      const url = new URL(destination);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      return res.redirect(302, '/');
    }

    if (tool?.id) {
      void supabase.from('affiliate_clicks').insert({
        tool_id: tool.id,
        tool_slug: slug,
        source,
        ip,
        user_agent: ua,
        clicked_at: new Date().toISOString(),
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, destination);
  } catch {
    return res.redirect(302, '/');
  }
}
