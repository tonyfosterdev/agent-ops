import Router from 'koa-router';
import { Context } from 'koa';
import { InventoryService } from '../services/inventoryService';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { UserRole } from '@agentops/shared';

const router = new Router({ prefix: '/inventory' });
const inventoryService = new InventoryService();

router.get('/books/:bookId', async (ctx: Context) => {
  const inventory = await inventoryService.getBookInventory(ctx.params.bookId);
  ctx.body = inventory;
});

router.post('/reconcile', basicAuth, requireRole(UserRole.STORE_ADMIN), async (ctx: Context) => {
  await inventoryService.reconcileInventory();
  ctx.body = { message: 'Inventory reconciliation started' };
});

export default router;
