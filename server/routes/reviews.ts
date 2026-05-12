import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { rateLimit } from '../lib/rateLimit.js';

const schema = z.object({
  tool_id: z.string().uuid(),
  author_name: z.string().trim().min(2).max(80),
  author_email: z.string().trim().toLowerCase().email().max(254),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(30).max(5000),
});

export async function reviewsHandler(req: Request, res: Response) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  const allowed = await rateLimit(`review:${ip}`, 3, 10 * 60);
  if (!allowed) return res.status(429).json({ error: 'rate_limited' });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_payload',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('tool_reviews').insert({
    tool_id: parsed.data.tool_id,
    author_name: parsed.data.author_name,
    author_email: parsed.data.author_email,
    rating: parsed.data.rating,
    title: parsed.data.title ?? null,
    body: parsed.data.body,
    verification_token: randomUUID(),
    token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    moderation_status: 'pending',
  });

  if (error) return res.status(500).json({ error: 'insert_failed', detail: error.message });
  return res.status(201).json({ message: 'Review submitted. Pending moderation.' });
}
