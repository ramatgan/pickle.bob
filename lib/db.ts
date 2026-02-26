import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

// PgBouncer in transaction mode (Supabase port 6543) does not support named
// prepared statements — they are connection-scoped and connections change between
// transactions. Setting prepare: false uses the simple query protocol instead.
export const sql = postgres(connectionString, {
  prepare: false,
  // In serverless (Vercel) each function instance is short-lived, so a small
  // pool size avoids exhausting Supabase's connection limit (60 on free tier).
  max: 3
});
