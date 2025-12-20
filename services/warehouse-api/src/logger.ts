import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const disablePrettyPrint = process.env.DISABLE_PRETTY_PRINT_LOGGING === 'true';

// Only use pino-pretty in development AND when not explicitly disabled (e.g., in Docker for Loki)
const usePrettyPrint = isDevelopment && !disablePrettyPrint;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'warehouse-api',
    environment: process.env.NODE_ENV || 'development',
  },
  ...(usePrettyPrint && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
