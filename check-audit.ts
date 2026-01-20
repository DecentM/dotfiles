import { Database } from 'bun:sqlite';
const db = new Database('/var/home/decentm/.opencode/audit/permissions.db');
// Force WAL checkpoint to make data visible
db.run('PRAGMA wal_checkpoint(FULL)');
const count = db.prepare('SELECT COUNT(*) as count FROM permissions').get();
console.log('Permission count:', count);
const sample = db.prepare('SELECT id, type, pattern, initial_status, user_response FROM permissions ORDER BY created_at DESC LIMIT 10').all();
console.log('Recent permissions:');
for (const row of sample) {
  console.log(`  ${row.type}: ${row.pattern} -> ${row.initial_status} (user: ${row.user_response ?? 'n/a'})`);
}
db.close();
