import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { errorHandler } from './middleware/errorHandler';
import { httpLogger } from './middleware/httpLogger';
import authRoutes from './routes/authRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import shipmentRoutes from './routes/shipmentRoutes';
import healthRoutes from './routes/healthRoutes';

export function createApp(): Koa {
  const app = new Koa();

  // Middleware
  app.use(errorHandler);
  app.use(httpLogger);
  app.use(cors());
  app.use(bodyParser());

  // Routes
  app.use(authRoutes.routes()).use(authRoutes.allowedMethods());
  app.use(inventoryRoutes.routes()).use(inventoryRoutes.allowedMethods());
  app.use(shipmentRoutes.routes()).use(shipmentRoutes.allowedMethods());
  app.use(healthRoutes.routes()).use(healthRoutes.allowedMethods());

  return app;
}
