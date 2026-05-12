import type { Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { rateLimit } from '../lib/rateLimit.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const ROLES = ['Solo founder', 'Freelancer', 'Small team', 'Agency', 'Enterprise'] as const;
const GOALS = ['Manage projects', 'Handle invoicing', 'CRM / Sales', 'Marketing & SEO', 'Team communication', 'Analytics', 'Customer support'] as const;

const bodySchema = z.object({
  role: z.enum(ROLES),
  goals: z.array(z.enum(GOALS)).min(1).max(3),
});

interface AIResponse {
  recommendations: Array<{ tool_id: string; why_this_tool: string }>;
}

async function callGroq(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const json = await res.json() as any;
  return JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as AIResponse;
}

async function callGemini(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1500, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const json = await res.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text ?? '{}') as AIResponse;
}

export async function stackHandler(req: Request, res: Response) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  const ok = await rateLimit(`stack:${ip}`, 10, 60);
  if (!ok) return res.status(429).json({ error: 'rate_limited' });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
  const { role, goals } = parsed.data;

  const supabase = getSupabaseAdmin();
  const { data: tools, error } = await supabase
    .from('tools')
    .select('id, slug, name, tagline, category_id, features, logo_url')
    .eq('moderation_status', 'approved')
    .limit(30);

  if (error) return res.status(500).json({ error: 'db_error' });

  const { data: cats } = await supabase.from('categories').select('id, name');
  const categoryMap = new Map((cats ?? []).map((c: any) => [c.id, c.name]));

  const slimTools = (tools ?? []).map((t: any) => ({
    id: t.id, name: t.name, tagline: t.tagline,
    category: t.category_id ? categoryMap.get(t.category_id) : null,
    features: (t.features ?? []).slice(0, 6),
  }));

  const prompt = `Given role: ${role}, goals: ${goals.join(', ')}. From this tool list: ${JSON.stringify(slimTools)}. Return JSON: { "recommendations": [{"tool_id":"...","why_this_tool":"1 sentence, max 15 words"}] } — pick 4-6 tools that complement each other, one per major goal. Return ONLY valid JSON.`;

  let aiResponse: AIResponse | null = null;
  try {
    aiResponse = await callGroq(prompt);
  } catch {
    try { aiResponse = await callGemini(prompt); }
    catch { return res.status(503).json({ error: 'ai_unavailable' }); }
  }

  if (!aiResponse?.recommendations?.length) return res.status(200).json({ stack: [] });

  const toolById = new Map((tools ?? []).map((t: any) => [t.id, t]));
  const stack = aiResponse.recommendations
    .map((rec) => {
      const tool = toolById.get(rec.tool_id) as any;
      if (!tool) return null;
      return { id: tool.id, slug: tool.slug, name: tool.name, tagline: tool.tagline, category_name: categoryMap.get(tool.category_id) ?? null, logo_url: tool.logo_url, why: rec.why_this_tool.trim() };
    })
    .filter(Boolean)
    .slice(0, 6);

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ stack });
}
