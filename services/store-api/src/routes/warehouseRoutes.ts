import Router from 'koa-router';
import { Context } from 'koa';
import { WarehouseService } from '../services/warehouseService';
import { bearerAuth } from '../middleware/bearerAuth';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { UserRole } from '@agentops/shared';

const router = new Router({ prefix: '/warehouses' });
const warehouseService = new WarehouseService();

router.post('/register', bearerAuth, async (ctx: Context) => {
  const { name, url, internalUrl } = ctx.request.body as any;

  const warehouse = await warehouseService.registerWarehouse(name, url, internalUrl);

  ctx.status = 201;
  ctx.body = {
    id: warehouse.id,
    name: warehouse.name,
    status: warehouse.status,
  };
});

router.get('/', basicAuth, requireRole(UserRole.STORE_ADMIN), async (ctx: Context) => {
  const warehouses = await warehouseService.listWarehouses();
  ctx.body = warehouses;
});

export default router;
