import { Pool } from "pg";

export function createPoolFromEnv() {
  const port = Number.parseInt(process.env.PG_PORT ?? "5432", 10);

  return new Pool({
    host: process.env.PG_HOST,
    port: Number.isNaN(port) ? 5432 : port,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE
  });
}
