/**
 * Express server for Railway deployment.
 * Serves Vite frontend (dist/) + all API routes.
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

// API route handlers
import { healthHandler } from './server/routes/health.js';
import { recommendHandler } from './server/routes/recommend.js';
import { reviewsHandler } from './server/routes/reviews.js';
import { sitemapHandler } from './server/routes/sitemap.js';
import { stackHandler } from './server/routes/stack.js';
import { vitalsHandler } from './server/routes/vitals.js';
import { logErrorHandler } from './server/routes/log-error.js';
import { redirectHandler } from './server/routes/redirect.js';
import { seoToolsHandler } from './server/routes/seo-tools.js';
import { seoTrackHandler } from './server/routes/seo-track.js';
import { ogToolHandler } from './server/routes/og-tool.js';
import { ogNicheHandler } from './server/routes/og-niche.js';
import { cronDailyHandler } from './server/routes/cron-daily.js';
import { cronPromoteAbHandler } from './server/routes/cron-promote-ab.js';
import { cronRefreshContentHandler } from './server/routes/cron-refresh-content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── API Routes ──────────────────────────────────────────────────────
app.get('/api/health', healthHandler);
app.post('/api/recommend', recommendHandler);
app.post('/api/reviews', reviewsHandler);
app.get('/api/sitemap', sitemapHandler);
app.get('/sitemap.xml', sitemapHandler);
app.post('/api/stack', stackHandler);
app.post('/api/vitals', vitalsHandler);
app.post('/api/log-error', logErrorHandler);
app.get('/api/redirect/:slug', redirectHandler);
app.get('/api/seo/tools', seoToolsHandler);
app.post('/api/seo/track', seoTrackHandler);
app.get('/api/og/tool', ogToolHandler);
app.get('/api/og/niche', ogNicheHandler);

// Cron endpoints (triggered by Railway cron or manually)
app.post('/api/cron/daily', cronDailyHandler);
app.post('/api/cron/promote-ab', cronPromoteAbHandler);
app.post('/api/cron/refresh-content', cronRefreshContentHandler);

// ── Scheduled Crons ──────────────────────────────────────────────────
const CRON_SECRET = process.env.CRON_SECRET;

function callCron(path: string) {
  const baseUrl = `http://localhost:${PORT}`;
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
  }).catch((err) => console.error(`Cron ${path} failed:`, err));
}

// Daily at 03:00 UTC
cron.schedule('0 3 * * *', () => callCron('/api/cron/daily'));
// Monday at 04:00 UTC
cron.schedule('0 4 * * 1', () => callCron('/api/cron/promote-ab'));
// Daily at 05:00 UTC
cron.schedule('0 5 * * *', () => callCron('/api/cron/refresh-content'));

// ── Serve Frontend ────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;
