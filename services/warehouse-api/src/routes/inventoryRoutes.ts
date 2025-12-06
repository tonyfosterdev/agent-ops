import Router from 'koa-router';
import { Context, Next } from 'koa';
import { InventoryService } from '../services/inventoryService';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { bearerAuth } from '../middleware/bearerAuth';
import { UserRole } from '@agentops/shared';

const router = new Router({ prefix: '/inventory' });
const inventoryService = new InventoryService();

// Middleware to accept either bearer auth (for Store API) or basic auth (for warehouse staff)
const flexibleAuth = async (ctx: Context, next: Next) => {
  const authHeader = ctx.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    // Use bearer auth for Store API
    return await bearerAuth(ctx, next);
  } else if (authHeader?.startsWith('Basic ')) {
    // Use basic auth for warehouse staff - chain both middleware
    return await basicAuth(ctx, async () => {
      return await requireRole(UserRole.WAREHOUSE_STAFF)(ctx, next);
    });
  } else {
    ctx.status = 401;
    ctx.body = { error: 'Authentication required' };
  }
};

// Get all inventory (temporarily public for UI testing - TODO: fix auth)
router.get('/', async (ctx: Context) => {
  const inventory = await inventoryService.getAllInventory();
  ctx.body = inventory;
});

// Get inventory for specific book
router.get('/:bookId', async (ctx: Context) => {
  const inventory = await inventoryService.getInventoryByBook(ctx.params.bookId);
  if (!inventory) {
    ctx.status = 404;
    ctx.body = { error: 'Inventory not found' };
    return;
  }
  ctx.body = inventory;
});

// Add or update inventory (staff only)
router.post('/', basicAuth, requireRole(UserRole.WAREHOUSE_STAFF), async (ctx: Context) => {
  const { bookId, isbn, quantity } = ctx.request.body as any;

  const inventory = await inventoryService.setInventory(bookId, isbn, quantity);

  ctx.status = 201;
  ctx.body = inventory;
});

// Update quantity (staff only)
router.patch('/:bookId', basicAuth, requireRole(UserRole.WAREHOUSE_STAFF), async (ctx: Context) => {
  const { quantity } = ctx.request.body as any;

  const inventory = await inventoryService.updateQuantity(ctx.params.bookId, quantity);

  ctx.body = inventory;
});

export default router;
