import type { Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { rateLimit } from '../lib/rateLimit.js';

const bodySchema = z.object({
  query: z.string().min(2).max(500),
  limit: z.number().int().min(1).max(20).optional(),
  excludeSlug: z.string().max(200).optional(),
});

export async function recommendHandler(req: Request, res: Response) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  const ok = await rateLimit(`rec:${ip}`, 30, 60);
  if (!ok) return res.status(429).json({ error: 'rate_limited' });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
  const { query, limit = 8, excludeSlug } = parsed.data;

  const supabase = getSupabaseAdmin();
  let excludeId: string | null = null;
  if (excludeSlug) {
    const { data } = await supabase.from('tools').select('id').eq('slug', excludeSlug).single();
    excludeId = data?.id ?? null;
  }

  let results: unknown[] = [];
  try {
    // Try semantic search first
    const { data, error } = await supabase.rpc('search_tools_fts', {
      query_text: query,
      match_count: limit,
    });
    if (error) throw error;
    results = (data ?? []).filter((r: { slug: string }) => r.slug !== excludeSlug);
  } catch {
    results = [];
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({ results });
}
