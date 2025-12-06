import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  warehouse: {
    name: process.env.WAREHOUSE_NAME || 'warehouse-unknown',
    url: process.env.WAREHOUSE_URL || 'http://localhost:3000',
    internalUrl: process.env.WAREHOUSE_INTERNAL_URL || 'http://localhost:3000',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'warehouseuser',
    password: process.env.DB_PASSWORD || 'warehousepass',
    database: process.env.DB_DATABASE || 'warehouse_db',
  },
  store: {
    apiUrl: process.env.STORE_API_URL || 'http://store-api:3000',
  },
  auth: {
    serviceSecret: process.env.SERVICE_SECRET || 'super-secret-shared-token',
  },
  registration: {
    retryIntervalSeconds: parseInt(process.env.REGISTRATION_RETRY_INTERVAL_SECONDS || '5', 10),
    maxRetries: parseInt(process.env.REGISTRATION_MAX_RETRIES || '10', 10),
  },
};
