import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production') {
  console.error('[FATAL] This script is strictly for isolated local QA and cannot be run in production.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const env = {
  ...process.env,
  PORT: '3456',
  DATABASE_FILE: path.resolve(repoRoot, 'data', 'isolated_qa_test.db'),
  AUTO_RETIRE_DUPLICATE_SOURCES: 'false',
  NODE_ENV: 'development',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_USER: 'test',
  SMTP_PASS: 'test',
  SMTP_SECURE: 'false',
  SMTP_FROM: '"Sarraf Ops" <no-reply@sarrafops.com>',
  APP_URL: 'http://127.0.0.1:3456'
};

console.log('[Runner] Starting server with DATABASE_FILE:', env.DATABASE_FILE, 'on PORT:', env.PORT);

const child = spawn('npx', ['tsx', 'server.ts'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code, signal) => {
  console.log(`[Runner] Server exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});
