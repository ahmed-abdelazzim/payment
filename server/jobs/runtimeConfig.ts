import { getOutboxRuntimeConfig } from './outboxWorker';
import { resolveConfiguredDatabaseFile } from '../db';

export interface RuntimeConfigurationIssue {
  code: string;
  severity: 'error' | 'warning';
}

export interface RuntimeConfigurationAssessment {
  isProduction: boolean;
  issues: RuntimeConfigurationIssue[];
}

/**
 * Reports deploy-time issues without including an environment value. In particular, this
 * function never echoes credentials or filesystem locations into an HTTP response or log.
 */
export function assessRuntimeConfiguration(): RuntimeConfigurationAssessment {
  const isProduction = process.env.NODE_ENV === 'production';
  const issues: RuntimeConfigurationIssue[] = [];
  const databaseFile = resolveConfiguredDatabaseFile();
  const outbox = getOutboxRuntimeConfig();

  if (isProduction && !databaseFile) {
    issues.push({ code: 'PRODUCTION_DATABASE_FILE_REQUIRED', severity: 'error' });
  }
  if (isProduction && databaseFile === ':memory:') {
    issues.push({ code: 'PRODUCTION_MEMORY_DATABASE_FORBIDDEN', severity: 'error' });
  }
  if (isProduction && databaseFile && databaseFile.endsWith('sarraf_ops.db')) {
    issues.push({ code: 'SQLITE_TEMPORARY_BRIDGE_ONLY', severity: 'warning' });
  }
  if (isProduction && process.env.APP_URL && !process.env.APP_URL.startsWith('https://')) {
    issues.push({ code: 'PRODUCTION_APP_URL_MUST_USE_HTTPS', severity: 'error' });
  }
  if (outbox.enabled !== outbox.deliveryEnabled) {
    issues.push({ code: 'OUTBOX_ENABLEMENT_MISMATCH', severity: 'error' });
  }
  if (outbox.embedded && !outbox.enabled) {
    issues.push({ code: 'OUTBOX_EMBEDDED_WITHOUT_WORKER', severity: 'error' });
  }

  return { isProduction, issues };
}

export function assertRuntimeConfiguration(): void {
  const assessment = assessRuntimeConfiguration();
  const errors = assessment.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw new Error(`RUNTIME_CONFIGURATION_INVALID:${errors.map((issue) => issue.code).join(',')}`);
  }
}
