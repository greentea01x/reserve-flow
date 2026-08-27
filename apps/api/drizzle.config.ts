import { defineConfig } from 'drizzle-kit';

// Migrations run as the schema owner (`postgres` on Supabase), never as rf_app, and never
// over the :6543 transaction pooler — see .env.example. `push` is banned outside local dev
// (§5.11): it introspects and would try to "fix" the EXCLUDE constraint it cannot model.
const url = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error('DATABASE_URL_MIGRATE (or DATABASE_URL) must be set to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
