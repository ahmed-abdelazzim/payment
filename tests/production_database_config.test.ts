import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveConfiguredDatabaseFile } from '../server/db';
import { assessRuntimeConfiguration } from '../server/jobs/runtimeConfig';

test('Railway production requires a durable configured SQLite location', () => {
  const keys = ['NODE_ENV', 'DATABASE_FILE', 'RAILWAY_VOLUME_MOUNT_PATH', 'RAILWAY_PROJECT_ID'];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'production';
    process.env.RAILWAY_PROJECT_ID = 'railway-test-project';
    delete process.env.DATABASE_FILE;
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    assert.equal(resolveConfiguredDatabaseFile(), undefined);
    assert.ok(assessRuntimeConfiguration().issues.some((issue) => issue.code === 'PRODUCTION_DATABASE_FILE_REQUIRED' && issue.severity === 'error'));

    process.env.RAILWAY_VOLUME_MOUNT_PATH = '/durable-data';
    assert.equal(resolveConfiguredDatabaseFile(), path.join('/durable-data', 'sarraf_ops.db'));
    assert.equal(assessRuntimeConfiguration().issues.some((issue) => issue.code === 'PRODUCTION_DATABASE_FILE_REQUIRED'), false);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
