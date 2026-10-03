import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './server/routes';
import { getDatabase } from './server/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  // Body parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.text({ type: ['text/*', 'text/plain'], limit: '5mb' }));

  // Gracefully handle malformed JSON from mobile automation webhooks
  app.use((err: any, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      (req as any).rawBody = (err as any).body;
      return next();
    }
    next(err);
  });

  // Initialize SQLite database
  getDatabase();

  // Mount API Gateway routes
  app.use('/api/v1', apiRouter);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Sarraf Ops Engine', timestamp: new Date().toISOString() });
  });

  if (!isProduction) {
    // Mount Vite dev server in middleware mode
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sarraf Ops] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Sarraf Ops] Failed to start server:', err);
  process.exit(1);
});
