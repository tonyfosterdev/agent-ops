import Router from 'koa-router';
import { Context } from 'koa';
import { OrderService } from '../services/orderService';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { UserRole, OrderStatus } from '@agentops/shared';
import { bearerAuth } from '../middleware/bearerAuth';

const router = new Router({ prefix: '/orders' });
const orderService = new OrderService();

router.post('/', basicAuth, async (ctx: Context) => {
  const { items, payment } = ctx.request.body as any;
  const userId = ctx.state.user.id;

  const order = await orderService.createOrder(userId, items, payment);
  ctx.status = 201;
  ctx.body = order;
});

router.get('/', basicAuth, async (ctx: Context) => {
  const user = ctx.state.user;

  let orders;
  if (user.role === UserRole.STORE_ADMIN) {
    orders = await orderService.getAllOrders();
  } else {
    orders = await orderService.getUserOrders(user.id);
  }

  ctx.body = orders;
});

router.get('/:id', basicAuth, async (ctx: Context) => {
  const order = await orderService.getOrder(ctx.params.id);
  if (!order) {
    ctx.status = 404;
    ctx.body = { error: 'Order not found' };
    return;
  }

  // Check permission
  const user = ctx.state.user;
  if (user.role !== UserRole.STORE_ADMIN && order.user_id !== user.id) {
    ctx.status = 403;
    ctx.body = { error: 'Access denied' };
    return;
  }

  ctx.body = order;
});

router.patch('/:id/status', bearerAuth, async (ctx: Context) => {
  const { status, shippedAt } = ctx.request.body as any;
  await orderService.updateOrderStatus(ctx.params.id, status as OrderStatus, shippedAt);
  ctx.body = { message: 'Order status updated' };
});

export default router;
