import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3200', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'admin123',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  workDir: process.env.WORK_DIR || '/workspace',
  composeProjectName: process.env.COMPOSE_PROJECT_NAME || 'agentops',
  lokiUrl: process.env.LOKI_URL || 'http://loki.localhost',

  // Ops Database (for Durable Runs)
  db: {
    host: process.env.OPS_DB_HOST || 'localhost',
    port: parseInt(process.env.OPS_DB_PORT || '5435', 10),
    username: process.env.OPS_DB_USERNAME || 'opsuser',
    password: process.env.OPS_DB_PASSWORD || 'opspassword',
    database: process.env.OPS_DB_DATABASE || 'ops_db',
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss',
          },
        }
      : undefined,
});
