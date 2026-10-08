import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './server/routes';
import { getDatabase } from './server/db';
import { OutboxWorker, getOutboxQueueSnapshot, getOutboxRuntimeConfig } from './server/jobs/outboxWorker';
import { assertRuntimeConfiguration, assessRuntimeConfiguration } from './server/jobs/runtimeConfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Production must choose its database path explicitly. This prevents an accidental deploy
  // from creating a fresh ./data/sarraf_ops.db inside an ephemeral application container.
  assertRuntimeConfiguration();

  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';
  const captureRawBody = (req: express.Request, _res: express.Response, buffer: Buffer) => {
    // The signed ingestion route hashes these original UTF-8 bytes. Do not rebuild the body
    // from JSON because whitespace and object key order are part of the signed request.
    (req as any).rawBody = buffer.toString('utf8');
  };

  // Body parsers
  app.use(express.json({ limit: '5mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '5mb', verify: captureRawBody }));
  app.use(express.text({ type: ['text/*', 'text/plain'], limit: '5mb', verify: captureRawBody }));

  // Gracefully handle malformed JSON from mobile automation webhooks
  app.use((err: any, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      // `verify` normally captured rawBody before parsing failed. Keep its original bytes when
      // present and only use body-parser's fallback when no capture occurred.
      if ((req as any).rawBody === undefined) {
        (req as any).rawBody = (err as any).body;
      }
      return next();
    }
    next(err);
  });

  // Initialize SQLite database
  getDatabase();

  const outboxConfig = getOutboxRuntimeConfig();
  let outboxWorker: OutboxWorker | null = null;
  if (outboxConfig.enabled && outboxConfig.embedded) {
    outboxWorker = new OutboxWorker();
    outboxWorker.start();
  } else if (outboxConfig.enabled) {
    console.info('[Sarraf Ops] Outbox delivery is enabled; expecting a separate worker process.');
  }

  // Serve Drop-in Checkout JS SDK
  app.use('/sdk', express.static(path.resolve(__dirname, 'server', 'public', 'sdk')));

  // Mount API Gateway routes
  app.use('/api/v1', apiRouter);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Sarraf Ops Engine',
      timestamp: new Date().toISOString(),
      outbox: {
        mode: outboxConfig.enabled ? (outboxConfig.embedded ? 'embedded' : 'external') : 'disabled',
        worker: outboxWorker?.getStatus() ?? null,
      },
    });
  });

  // Readiness intentionally verifies the local dependencies without returning configuration
  // values, payloads, credentials, or customer data.
  app.get('/ready', (_req, res) => {
    try {
      getDatabase().prepare('SELECT 1 AS ready').get();
      const assessment = assessRuntimeConfiguration();
      const errors = assessment.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code);
      const warnings = assessment.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code);
      const ready = errors.length === 0;
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        service: 'Sarraf Ops Engine',
        database: 'connected',
        outbox: getOutboxQueueSnapshot(),
        configuration: { errors, warnings },
      });
    } catch {
      res.status(503).json({
        status: 'not_ready',
        service: 'Sarraf Ops Engine',
        database: 'unavailable',
      });
    }
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sarraf Ops] Server running at http://0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[Sarraf Ops] Graceful shutdown after ${signal}`);
    await outboxWorker?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

startServer().catch((err) => {
  const code = err instanceof Error && err.message.startsWith('RUNTIME_CONFIGURATION_INVALID:')
    ? err.message
    : 'SERVER_STARTUP_FAILED';
  console.error(`[Sarraf Ops] ${code}`);
  process.exit(1);
});
