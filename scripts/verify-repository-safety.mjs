import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const trackedFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repositoryRoot, encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const violations = [];
const forbiddenDataFile = /(^|\/)(?:data\/.*\.(?:db|db-wal|db-shm|sqlite|sqlite3)|.*\.(?:db-wal|db-shm|sqlite|sqlite3))$/i;

for (const file of trackedFiles) {
  if (forbiddenDataFile.test(file)) {
    violations.push({ file, reason: 'tracked database or write-ahead-log file' });
  }
  if ((file === '.env' || file.startsWith('.env.')) && file !== '.env.example') {
    violations.push({ file, reason: 'tracked environment file' });
  }
}

const sourceFiles = trackedFiles.filter((file) => (
  /^(?:server|src|scripts|\.github)\//.test(file) || file === 'server.ts'
) && /\.(?:[cm]?[jt]sx?|json|ya?ml)$/i.test(file));

const secretPatterns = [
  { reason: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { reason: 'hard-coded device secret', pattern: /\bsec_[A-Za-z0-9_]{16,}\b/ },
  { reason: 'hard-coded production webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{20,}\b/ },
  { reason: 'hard-coded production provider key', pattern: /\b(?:sk|rk|re)_(?:live|prod)_[A-Za-z0-9_-]{16,}\b/i },
];

for (const file of sourceFiles) {
  const absolutePath = path.join(repositoryRoot, file);
  if (!fs.existsSync(absolutePath)) continue;
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const { reason, pattern } of secretPatterns) {
    const lineNumber = lines.findIndex((line) => pattern.test(line));
    if (lineNumber >= 0) {
      // Do not print the matching content: CI logs must not become a second disclosure path.
      violations.push({ file, reason: `${reason} (line ${lineNumber + 1})` });
    }
  }
}

if (violations.length) {
  console.error('Repository safety guard failed:');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log('Repository safety guard passed.');
