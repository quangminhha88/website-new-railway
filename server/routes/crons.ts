import type { Request, Response } from 'express';
import { getSupabaseAdmin } from '../lib/supabase.js';

function checkCronAuth(req: Request, res: Response): boolean {
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// ── Daily Cron ────────────────────────────────────────────────────────
const ASSUMED_CONVERSION_RATE = 0.02;
const CONFIDENCE_HALF_LIFE = 100;

export async function cronDailyHandler(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;

  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();
  const stats = { tools_updated: 0, matviews_refreshed: 0, errors: [] as string[] };

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tools, error } = await supabase
      .from('tools').select('id, slug, commission_estimate').eq('moderation_status', 'approved');
    if (error) throw error;

    for (const tool of tools ?? []) {
      const { count } = await supabase
        .from('affiliate_clicks').select('*', { count: 'exact', head: true })
        .eq('tool_id', tool.id).gte('clicked_at', since);
      const clicks = count ?? 0;
      const conversions = Math.round(clicks * ASSUMED_CONVERSION_RATE);
      const revenue = conversions * ((tool as any).commission_estimate ?? 0);
      const epc = clicks > 0 ? revenue / clicks : 0;
      const confidence = 1 - Math.exp(-clicks / CONFIDENCE_HALF_LIFE);
      await supabase.from('tool_epc').upsert({
        tool_id: (tool as any).id, tool_slug: (tool as any).slug,
        clicks_30d: clicks, conversions_30d: conversions,
        revenue_30d: Number(revenue.toFixed(2)), epc: Number(epc.toFixed(4)),
        confidence: Number(confidence.toFixed(3)), computed_at: new Date().toISOString(),
      }, { onConflict: 'tool_id' });
      stats.tools_updated++;
    }
  } catch (err) {
    stats.errors.push(`epc: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { error } = await supabase.rpc('refresh_analytics_matviews');
    if (error) throw error;
    stats.matviews_refreshed = 3;
  } catch (err) {
    stats.errors.push(`matviews: ${err instanceof Error ? err.message : String(err)}`);
  }

  return res.status(200).json({ ok: stats.errors.length === 0, duration_ms: Date.now() - startedAt, ...stats });
}

// ── Promote AB Cron ───────────────────────────────────────────────────
const MIN_IMPRESSIONS = 200;
const MIN_LIFT = 0.10;
const Z_THRESHOLD = 1.96;

export async function cronPromoteAbHandler(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;

  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();
  const stats = { promoted: 0, skipped: 0, errors: [] as string[] };

  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events, error } = await supabase
      .from('seo_metrics').select('resource_slug, variant_index, event_type')
      .gte('created_at', since).not('variant_index', 'is', null);
    if (error) throw error;

    // Group by slug + variant
    const variantMap = new Map<string, Map<number, { impressions: number; clicks: number }>>();
    for (const e of events ?? []) {
      const slug = (e as any).resource_slug;
      const vi = (e as any).variant_index;
      if (!variantMap.has(slug)) variantMap.set(slug, new Map());
      const vm = variantMap.get(slug)!;
      if (!vm.has(vi)) vm.set(vi, { impressions: 0, clicks: 0 });
      const v = vm.get(vi)!;
      if ((e as any).event_type === 'impression') v.impressions++;
      else if ((e as any).event_type === 'affiliate_click') v.clicks++;
    }

    for (const [slug, variants] of variantMap) {
      const entries = Array.from(variants.entries()).map(([vi, d]) => ({ vi, ...d, ctr: d.impressions > 0 ? d.clicks / d.impressions : 0 }));
      const baseline = entries.find((e) => e.vi === 0);
      if (!baseline || baseline.impressions < MIN_IMPRESSIONS) { stats.skipped++; continue; }

      let bestWinner = null;
      for (const variant of entries.filter((e) => e.vi !== 0)) {
        if (variant.impressions < MIN_IMPRESSIONS) continue;
        const lift = (variant.ctr - baseline.ctr) / (baseline.ctr || 1);
        if (lift < MIN_LIFT) continue;
        // Simple Z-test approximation
        const p1 = baseline.ctr, p2 = variant.ctr;
        const n1 = baseline.impressions, n2 = variant.impressions;
        const pooled = (baseline.clicks + variant.clicks) / (n1 + n2);
        const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
        const z = se > 0 ? Math.abs(p2 - p1) / se : 0;
        if (z >= Z_THRESHOLD && (!bestWinner || variant.ctr > bestWinner.ctr)) bestWinner = variant;
      }

      if (bestWinner) {
        await supabase.from('tools').update({ winning_cta_variant: bestWinner.vi }).eq('slug', slug);
        stats.promoted++;
      } else {
        stats.skipped++;
      }
    }
  } catch (err) {
    stats.errors.push(err instanceof Error ? err.message : String(err));
  }

  return res.status(200).json({ ok: stats.errors.length === 0, duration_ms: Date.now() - startedAt, ...stats });
}

// ── Refresh Content Cron ──────────────────────────────────────────────
export async function cronRefreshContentHandler(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;

  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();
  const stats = { candidates: 0, refreshed: 0, failed: 0, errors: [] as string[] };

  try {
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tools } = await supabase
      .from('tools').select('id, slug, name, description, updated_at')
      .eq('moderation_status', 'approved')
      .lt('updated_at', staleDate).limit(8);

    stats.candidates = (tools ?? []).length;

    for (const tool of tools ?? []) {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set');

        const prompt = `You are a SaaS tool reviewer. Write a compelling 200-word description for "${(tool as any).name}". Current description: "${(tool as any).description}". Return JSON: {"full_description": "..."}`;
        const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
        });
        if (!gemRes.ok) throw new Error(`Gemini ${gemRes.status}`);
        const json = await gemRes.json() as any;
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = JSON.parse(text ?? '{}');

        await supabase.from('tools').update({
          full_description: parsed.full_description,
          moderation_status: 'pending_review',
          updated_at: new Date().toISOString(),
        }).eq('id', (tool as any).id);
        stats.refreshed++;
      } catch (err) {
        stats.failed++;
        stats.errors.push(`${(tool as any).slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    stats.errors.push(err instanceof Error ? err.message : String(err));
  }

  return res.status(200).json({ ok: stats.failed === 0, duration_ms: Date.now() - startedAt, ...stats });
}
