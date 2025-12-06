import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'storeuser',
    password: process.env.DB_PASSWORD || 'storepass',
    database: process.env.DB_DATABASE || 'store_db',
  },
  auth: {
    serviceSecret: process.env.SERVICE_SECRET || 'super-secret-shared-token',
  },
  jobs: {
    healthCheckIntervalSeconds: parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS || '60', 10),
    inventoryReconciliationIntervalSeconds: parseInt(process.env.INVENTORY_RECONCILIATION_INTERVAL_SECONDS || '300', 10),
  },
};
