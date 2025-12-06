import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { errorHandler } from './middleware/errorHandler';
import { httpLogger } from './middleware/httpLogger';
import authRoutes from './routes/authRoutes';
import bookRoutes from './routes/bookRoutes';
import orderRoutes from './routes/orderRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import inventoryRoutes from './routes/inventoryRoutes';

export function createApp(): Koa {
  const app = new Koa();

  // Middleware
  app.use(errorHandler);
  app.use(httpLogger);
  app.use(cors());
  app.use(bodyParser());

  // Routes
  app.use(authRoutes.routes()).use(authRoutes.allowedMethods());
  app.use(bookRoutes.routes()).use(bookRoutes.allowedMethods());
  app.use(orderRoutes.routes()).use(orderRoutes.allowedMethods());
  app.use(warehouseRoutes.routes()).use(warehouseRoutes.allowedMethods());
  app.use(inventoryRoutes.routes()).use(inventoryRoutes.allowedMethods());

  // Health check
  app.use(async (ctx) => {
    if (ctx.path === '/health') {
      ctx.body = { status: 'ok', service: 'store-api' };
    }
  });

  return app;
}
