import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  console.log("Dropping old auth_state table...");
  await client.execute('DROP TABLE IF EXISTS auth_state');
  console.log("Done.");
}

run().catch(console.error);
