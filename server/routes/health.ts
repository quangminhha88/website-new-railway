import type { Request, Response } from 'express';

export async function healthHandler(req: Request, res: Response) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}
