import dotenv from 'dotenv';
import Joi from 'joi';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// DB_HOST/USER/PASSWORD/NAME are only required when DATABASE_URL is absent — Neon (and
// most managed Postgres hosts) hand out a single connection string, not discrete fields
// (spec 38 Phase 4).
const requiredUnlessDatabaseUrl = { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() };

const schema = Joi.object({
  DATABASE_URL: Joi.string().optional(),
  DB_HOST: Joi.string().when('DATABASE_URL', requiredUnlessDatabaseUrl),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().when('DATABASE_URL', requiredUnlessDatabaseUrl),
  DB_PASSWORD: Joi.string().allow('').when('DATABASE_URL', requiredUnlessDatabaseUrl),
  DB_NAME: Joi.string().when('DATABASE_URL', requiredUnlessDatabaseUrl),
  SERVER_PORT: Joi.number().default(4001),
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  // Origin the global CORS policy allows (packages/server/src/app.ts) — the deployed
  // Vercel client URL in production; defaults to the local Vite dev server otherwise.
  CLIENT_URL: Joi.string().uri().default('http://localhost:4000'),
}).unknown(true);

const { error, value } = schema.validate(process.env);

if (error) {
  console.error(`\n❌ Environment validation failed:\n   ${error.message}\n`);
  console.error('   Check your .env file against .env.example\n');
  process.exit(1);
}

export const config = {
  db: {
    host: value.DB_HOST as string | undefined,
    port: value.DB_PORT as number,
    user: value.DB_USER as string | undefined,
    password: value.DB_PASSWORD as string | undefined,
    database: value.DB_NAME as string | undefined,
  },
  databaseUrl: value.DATABASE_URL as string | undefined,
  port: value.SERVER_PORT as number,
  nodeEnv: value.NODE_ENV as string,
  clientUrl: value.CLIENT_URL as string,
};
