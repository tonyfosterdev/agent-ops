import axios from 'axios';
import { config } from '../config';
import { RegisterWarehouseRequest } from '@agentops/shared';
import { logger } from '../logger';

export class RegistrationService {
  async registerWithStore(): Promise<boolean> {
    const payload: RegisterWarehouseRequest = {
      name: config.warehouse.name,
      url: config.warehouse.url,
      internalUrl: config.warehouse.internalUrl,
    };

    try {
      const response = await axios.post(`${config.store.apiUrl}/warehouses/register`, payload, {
        headers: {
          Authorization: `Bearer ${config.auth.serviceSecret}`,
        },
        timeout: 5000,
      });

      logger.info({ warehouse: response.data.name, status: response.data.status }, 'Successfully registered with Store');
      return true;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        logger.info('Store API not available yet, will retry');
      } else {
        logger.error({ error: error.message }, 'Registration failed');
      }
      return false;
    }
  }

  async registerWithRetry(): Promise<void> {
    const maxRetries = config.registration.maxRetries;
    const retryInterval = config.registration.retryIntervalSeconds * 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info({ attempt, maxRetries }, 'Registration attempt');

      const success = await this.registerWithStore();
      if (success) {
        return;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    }

    logger.error('Failed to register with Store after maximum retries');
    process.exit(1);
  }
}
