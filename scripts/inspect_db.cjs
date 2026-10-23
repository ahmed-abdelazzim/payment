if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production') {
  console.error('[FATAL] Database inspection script cannot run in production.');
  process.exit(1);
}
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/isolated_qa_test.db');

console.log('payment_sources schema:');
console.log(db.prepare("PRAGMA table_info(payment_sources)").all());

console.log('\nSources:');
console.log(db.prepare('SELECT * FROM payment_sources').all());

console.log('\nDevices:');
console.log(db.prepare('SELECT * FROM devices').all());

console.log('\nTransactions:');
console.log(db.prepare('SELECT * FROM transactions LIMIT 5').all());

console.log('\nPayment links:');
console.log(db.prepare('SELECT * FROM payment_links LIMIT 5').all());
