import { getDatabase } from '../db';
import { OutboxWorker, getOutboxRuntimeConfig } from './outboxWorker';
import { assertRuntimeConfiguration } from './runtimeConfig';

async function startWorker(): Promise<void> {
  assertRuntimeConfiguration();
  const config = getOutboxRuntimeConfig();
  if (!config.enabled || !config.deliveryEnabled) {
    throw new Error('OUTBOX_WORKER_AND_DELIVERY_MUST_BE_EXPLICITLY_ENABLED');
  }

  getDatabase();
  const worker = new OutboxWorker();
  worker.start();
  console.info('[Outbox] Worker started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[Outbox] Worker stopping after ${signal}`);
    await worker.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

startWorker().catch((error) => {
  const code = error instanceof Error && error.message.startsWith('RUNTIME_CONFIGURATION_INVALID:')
    ? error.message
    : 'OUTBOX_WORKER_STARTUP_FAILED';
  console.error(`[Outbox] ${code}`);
  process.exit(1);
});
