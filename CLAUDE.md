# Claude Code Context - AgentOps

## Project Overview

This repository demonstrates a **durable ops agent framework** with human-in-the-loop approval, using a distributed bookstore application as a test environment.

**Agent Framework Features**:
- Human-in-the-Loop (HITL) - Dangerous operations pause for human approval
- Event Sourcing - All agent state derived from append-only journal for crash recovery
- Multi-agent Orchestration - Route tasks to specialized agents based on capabilities
- Real-time Dashboard - Watch agent progress and approve actions via web UI

**Bookstore Test Application**:
- Book catalog management
- Customer orders with payment tracking
- Distributed inventory across warehouses
- Automatic warehouse registration
- Periodic inventory reconciliation
- Order fulfillment with warehouse selection

## Quick Start

### Environment Setup (Required First Time)

Copy the environment template before starting:

```bash
cp .env.example .env
```

### Start Everything

**Automated Setup (Recommended)**:
```bash
# One-command startup (handles logging plugin + docker compose)
./scripts/start.sh --build

# Or in detached mode
./scripts/start.sh --build -d
```

The startup script automatically:
- Installs Docker Loki logging plugin (if not already installed)
- Builds and starts all services
- Seeds databases on startup

**Manual Approach**:
```bash
# 1. Install logging plugin (one-time setup)
./scripts/setup-logging.sh

# 2. Start services
docker compose up --build

# Or in detached mode
docker compose up --build -d
```

**View Logs**:
```bash
docker compose logs -f
docker compose logs -f store-api
docker compose logs -f warehouse-alpha
```

### Database Seeding

**Automatic Seeding**: The system automatically runs seed scripts on container startup. This happens every time containers start, but the scripts are idempotent (safe to run multiple times).

**Manual Seeding** (optional):
```bash
# Seed Store (books, users)
docker compose exec store-api npm run seed

# Seed Warehouse Alpha (inventory, staff)
docker compose exec warehouse-alpha npm run seed

# Seed Warehouse Beta (inventory, staff)
docker compose exec warehouse-beta npm run seed
```

### Access Points

- **Agent Dashboard**: http://localhost:3001 (submit tasks, approve actions)
- **Agent Server API**: http://api.localhost/agents
- **Bookstore UI**: http://localhost
- **Store API**: http://api.localhost/store
- **Warehouse Alpha**: http://api.localhost/warehouses/alpha
- **Warehouse Beta**: http://api.localhost/warehouses/beta
- **Traefik Dashboard**: http://localhost:8080
- **Grafana (Logs)**: http://grafana.localhost (no login required)
- **Loki API**: http://loki.localhost

### Test Credentials

**Store**:
- Admin: `admin@bookstore.com:admin123`
- Customer: `alice@customer.com:alice123`

**Warehouse Alpha**:
- Staff: `staff@warehouse-alpha.com:staff123`

**Warehouse Beta**:
- Staff: `staff@warehouse-beta.com:staff123`

**Service Token**: `super-secret-shared-token-change-me`

## Development Commands

### Store API

```bash
# Install dependencies
cd services/store-api && npm install

# Run locally (outside Docker)
npm run dev

# Build
npm run build

# Run migrations
npm run migration:run

# Generate migration
npm run migration:generate -- -n MigrationName

# Seed database
npm run seed
```

### Warehouse API

```bash
# Install dependencies
cd services/warehouse-api && npm install

# Run locally (outside Docker)
npm run dev

# Build
npm run build

# Seed database
npm run seed
```

### Agent Framework (ops/)

```bash
cd ops
npm install              # Install dependencies
npm run build            # Build all packages
npm run dev:server       # Run agent server (port 3200)
npm run dev:dashboard    # Run dashboard (port 3001)
```

Key packages:
- `ops/packages/agent-server/` - Hono HTTP server + agents
- `ops/packages/dashboard/` - React dashboard with approval UI
- `ops/packages/shared/` - Common types and utilities

### Docker Commands

```bash
# Rebuild single service
docker compose up --build store-api

# Stop all services
docker compose down

# Remove volumes (DELETES DATA)
docker compose down -v

# Restart service
docker compose restart store-api

# View service status
docker compose ps

# Execute command in container
docker compose exec store-api sh
```

### Database Access

```bash
# Store DB
docker compose exec store-db psql -U storeuser -d store_db

# Warehouse Alpha DB
docker compose exec warehouse-alpha-db psql -U warehouseuser -d warehouse_alpha_db

# Common queries
SELECT * FROM users;
SELECT * FROM books LIMIT 10;
SELECT * FROM orders WHERE status = 'PENDING';
SELECT * FROM warehouse_registry;
SELECT * FROM inventory_cache;
```

## Architecture Rules

### ALWAYS Follow These Rules

1. **No Direct Database Access Between Services**
   - Store cannot query Warehouse databases directly
   - All communication via HTTP APIs
   - Use Bearer token for service-to-service calls

2. **Use TypeORM for All Database Operations**
   - Never write raw SQL (unless absolutely necessary)
   - Use repositories and entities
   - Let TypeORM handle migrations in development

3. **Authentication Middleware Order**
   - Basic Auth for user endpoints
   - Bearer Auth for service endpoints
   - Check auth before business logic

4. **Error Handling**
   - Always use try-catch in route handlers
   - Return proper HTTP status codes
   - Log errors with context

5. **Background Jobs**
   - Use node-cron for scheduled tasks
   - Jobs should be idempotent
   - Handle failures gracefully

6. **Service Communication**
   - Always set timeout on axios calls (5-10 seconds)
   - Handle connection refused errors
   - Retry with exponential backoff when appropriate

### Code Organization

```
services/
  store-api/
    src/
      entities/       # TypeORM entities (database models)
      routes/         # Koa route handlers
      services/       # Business logic (stateless)
      middleware/     # Auth, error handling
      jobs/           # Background jobs (cron)
      database.ts     # TypeORM DataSource
      config.ts       # Configuration loader
      app.ts          # Koa app setup
      index.ts        # Entry point
```

**Rules**:
- Controllers (routes) should be thin - delegate to services
- Services contain business logic
- No business logic in entities (they're just data models)
- Middleware should be pure and composable

## Common Tasks

### Add a New Endpoint

1. Create route handler in `src/routes/`
2. Implement business logic in `src/services/`
3. Add route to `src/app.ts`
4. Test with curl or Postman

Example:
```typescript
// src/routes/exampleRoutes.ts
import Router from 'koa-router';
import { ExampleService } from '../services/exampleService';
import { basicAuth } from '../middleware/basicAuth';

const router = new Router({ prefix: '/example' });
const exampleService = new ExampleService();

router.get('/', basicAuth, async (ctx) => {
  const result = await exampleService.doSomething();
  ctx.body = result;
});

export default router;

// Add to src/app.ts
import exampleRoutes from './routes/exampleRoutes';
app.use(exampleRoutes.routes()).use(exampleRoutes.allowedMethods());
```

### Add a New Database Table

1. Create entity in `src/entities/`
2. Add to DataSource entities array in `src/database.ts`
3. Let TypeORM auto-sync (dev) or generate migration (prod)

Example:
```typescript
// src/entities/NewEntity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('new_entities')
export class NewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;
}

// Add to src/database.ts
import { NewEntity } from './entities/NewEntity';

entities: [User, Book, ..., NewEntity]
```

### Add a Background Job

1. Create job file in `src/jobs/`
2. Start job in `src/index.ts`

Example:
```typescript
// src/jobs/myJob.ts
import cron from 'node-cron';

export function startMyJob(): void {
  cron.schedule('*/30 * * * * *', async () => {
    console.log('Running my job...');
    // Do work
  });
}

// Add to src/index.ts
import { startMyJob } from './jobs/myJob';
startMyJob();
```

## Debugging Tips

### Warehouse Not Registering

**Symptoms**: Warehouse shows "Failed to register" in logs

**Checks**:
1. Is Store API running? `docker compose ps`
2. Is Store API healthy? `curl http://api.localhost/store/health`
3. Is Bearer token correct in both services?
4. Check Store logs: `docker compose logs store-api`

**Fix**: Restart warehouse after Store is fully up

### Order Failing

**Symptoms**: POST /orders returns 500 error

**Checks**:
1. Is warehouse healthy? Check `/warehouses` endpoint
2. Does warehouse have stock? Check inventory cache
3. Check Store logs for specific error
4. Verify book IDs are valid UUIDs from `/books`

**Common Issues**:
- Inventory cache not synced (run reconciliation)
- Warehouse offline (restart it)
- Invalid book ID

### Inventory Reconciliation Not Working

**Symptoms**: Inventory cache shows 0 or stale data

**Checks**:
1. Are warehouses registered and HEALTHY?
2. Has reconciliation job run? (Check logs every 5 minutes)
3. Does warehouse have inventory? Query warehouse directly
4. Is Bearer token correct?

**Fix**: Trigger manual reconciliation:
```bash
curl -X POST \
  -u admin@bookstore.com:admin123 \
  http://api.localhost/store/inventory/reconcile
```

### Database Connection Issues

**Symptoms**: "Connection refused" or "password authentication failed"

**Checks**:
1. Are databases running? `docker compose ps`
2. Check health: `docker compose exec store-db pg_isready`
3. Verify environment variables match docker-compose.yaml
4. Check database logs: `docker compose logs store-db`

**Fix**: Restart database service, ensure credentials match

### TypeScript Build Errors

**Symptoms**: Build fails with type errors

**Fixes**:
- Run `npm install` to ensure dependencies are up to date
- Check `tsconfig.json` is correct
- Ensure all imports use correct paths
- Verify entities have proper decorators

### Docker Volume Issues

**Symptoms**: Old data persists, migrations not applying

**Fix**: Remove volumes and rebuild:
```bash
docker compose down -v
docker compose up --build
```

**⚠️ WARNING**: This deletes all data!

## API Testing Examples

### Place an Order

```bash
# 1. Login to get user info
curl -X POST http://api.localhost/store/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@customer.com", "password": "alice123"}'

# 2. Get books and their IDs
curl http://api.localhost/store/books | jq '.[] | {id, title, price, total_inventory}'

# 3. Place order
curl -X POST http://api.localhost/store/orders \
  -u alice@customer.com:alice123 \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"bookId": "<BOOK_ID_FROM_STEP_2>", "quantity": 2}
    ],
    "payment": {
      "method": "credit_card",
      "amount": 29.98
    }
  }' | jq

# 4. Check order status
curl -u alice@customer.com:alice123 \
  http://api.localhost/store/orders | jq
```

### Manage Warehouse Inventory

```bash
# Check current inventory
curl http://api.localhost/warehouses/alpha/inventory | jq

# Update book quantity
curl -X PATCH http://api.localhost/warehouses/alpha/inventory/<BOOK_ID> \
  -u staff@warehouse-alpha.com:staff123 \
  -H "Content-Type: application/json" \
  -d '{"quantity": 100}' | jq

# View shipment history
curl -u staff@warehouse-alpha.com:staff123 \
  http://api.localhost/warehouses/alpha/shipments | jq
```

## Known Limitations

1. **Single Warehouse Fulfillment Only**
   - Orders must be fulfilled by one warehouse
   - If split shipping needed, throw error for now
   - Future: Implement order splitting logic

2. **No Transaction Rollbacks Across Services**
   - If warehouse fails after order created, order stays PENDING
   - Manual intervention required
   - Future: Implement saga pattern or event sourcing

3. **Polling-Based Inventory Sync**
   - 5-minute delay in inventory updates
   - Not real-time
   - Future: WebSockets or event-driven architecture

4. **No Authentication Token Expiry**
   - Bearer tokens never expire
   - Restart required to change tokens
   - Future: JWT with refresh tokens

5. **Limited Error Recovery**
   - Failed shipments require manual retry
   - No dead letter queue
   - Future: Add retry queue and compensating transactions

## Logging and Observability

This project uses structured JSON logging with **Pino**, **Loki** for log aggregation, and **Grafana** for visualization.

### Quick Access

- **Grafana Dashboard**: http://grafana.localhost (no login required)
- **Full Documentation**: See [docs/LOGGING.md](docs/LOGGING.md)

### Viewing Logs

**Option 1: Grafana (Recommended)**
1. Open http://grafana.localhost (instant access, no login)
2. Navigate to "Explore" (compass icon)
3. Query logs using LogQL:
   ```logql
   {service="store-api"}
   {service="warehouse-alpha"}
   {service="warehouse-beta"}
   ```

**Option 2: Docker Logs**
```bash
docker compose logs -f store-api
docker compose logs -f warehouse-alpha
docker compose logs -f warehouse-beta
```

### Common Log Queries

**View errors only**:
```logql
{service="store-api"} |= "ERROR"
```

**Search for specific text**:
```logql
{service="store-api"} |= "inventory reconciliation"
```

**Filter by warehouse**:
```logql
{service="store-api"} | json | warehouse="warehouse-alpha"
```

### Using Logger in Code

```typescript
import { logger } from './logger';

// Structured logging (recommended)
logger.info({ orderId: '123', customerId: '456' }, 'Order created');
logger.error({ error, orderId: '123' }, 'Failed to process order');

// Simple logging
logger.info('Server started');
logger.warn('Warehouse unhealthy');
```

**Log Levels**: `debug`, `info`, `warn`, `error`, `fatal`

### Troubleshooting

**No logs in Grafana?**
- Check Loki is running: `docker compose ps loki`
- View Loki logs: `docker compose logs loki`
- Verify Docker Loki plugin installed: `docker plugin ls | grep loki`

**Install/Setup Docker Loki Plugin**:
```bash
# Automated (recommended)
./scripts/setup-logging.sh

# Or manual
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions

# Then restart services
docker compose down && docker compose up -d
```

## Testing Checklist

Before committing changes, verify:

- [ ] All services start: `./scripts/start.sh --build`
- [ ] No errors in logs
- [ ] Warehouses register successfully
- [ ] Books endpoint returns data
- [ ] Order placement succeeds (end-to-end)
- [ ] Inventory reconciliation works
- [ ] Health checks update warehouse status
- [ ] Logs appear in Grafana

## Useful Resources

- [TypeORM Documentation](https://typeorm.io/)
- [Koa.js Guide](https://koajs.com/)
- [Traefik Docs](https://doc.traefik.io/traefik/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Pino Logger](https://getpino.io/)
- [Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)

## Contact

For questions or issues, refer to the project's GitHub repository.
