import Router from 'koa-router';
import { Context } from 'koa';
import { ShipmentService } from '../services/shipmentService';
import { bearerAuth } from '../middleware/bearerAuth';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { ShipmentInstructionRequest, UserRole } from '@agentops/shared';

const router = new Router({ prefix: '/shipments' });
const shipmentService = new ShipmentService();

// Receive shipment instruction from Store
router.post('/', bearerAuth, async (ctx: Context) => {
  const instruction = ctx.request.body as ShipmentInstructionRequest;

  const confirmation = await shipmentService.processShipment(instruction);

  ctx.status = 200;
  ctx.body = confirmation;
});

// Get shipment history (staff only)
router.get('/', basicAuth, requireRole(UserRole.WAREHOUSE_STAFF), async (ctx: Context) => {
  const shipments = await shipmentService.getShipmentHistory();
  ctx.body = shipments;
});

export default router;
