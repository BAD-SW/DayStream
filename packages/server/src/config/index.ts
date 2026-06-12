import dotenv from 'dotenv';
import Joi from 'joi';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const schema = Joi.object({
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  SERVER_PORT: Joi.number().default(4001),
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
}).unknown(true);

const { error, value } = schema.validate(process.env);

if (error) {
  console.error(`\n❌ Environment validation failed:\n   ${error.message}\n`);
  console.error('   Check your .env file against .env.example\n');
  process.exit(1);
}

export const config = {
  db: {
    host: value.DB_HOST as string,
    port: value.DB_PORT as number,
    user: value.DB_USER as string,
    password: value.DB_PASSWORD as string,
    database: value.DB_NAME as string,
  },
  port: value.SERVER_PORT as number,
  nodeEnv: value.NODE_ENV as string,
};
