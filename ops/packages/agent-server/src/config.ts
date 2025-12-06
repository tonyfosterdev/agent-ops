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
  lokiUrl: process.env.LOKI_URL || 'http://loki.localhost',
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
