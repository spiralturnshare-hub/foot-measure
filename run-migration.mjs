import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const conn = await createConnection(url);

const sqls = [
  "ALTER TABLE `measurements` ADD COLUMN `insoleImageKey` text",
  "ALTER TABLE `measurements` ADD COLUMN `insoleImageUrl` text",
  "ALTER TABLE `measurements` ADD COLUMN `insoleImageWidth` int",
  "ALTER TABLE `measurements` ADD COLUMN `insoleImageHeight` int",
  "ALTER TABLE `measurements` ADD COLUMN `insolePointsJson` json",
  "ALTER TABLE `measurements` ADD COLUMN `insoleLength` float",
];

for (const sql of sqls) {
  try {
    await conn.execute(sql);
    console.log('OK:', sql.slice(0, 60));
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('SKIP (already exists):', sql.slice(0, 60));
    } else {
      console.error('ERROR:', e.message, sql.slice(0, 60));
    }
  }
}

await conn.end();
console.log('Migration complete.');
