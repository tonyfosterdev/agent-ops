# Logging and Observability

This project uses a comprehensive logging stack with **Pino** for structured JSON logging, **Loki** for log aggregation, and **Grafana** for visualization.

## Architecture

```
Application (Pino) → Docker Logs → Loki → Grafana
```

- **Pino**: Fast JSON logger for Node.js applications
- **Loki**: Log aggregation system by Grafana Labs
- **Grafana**: Dashboards and query interface for logs

## Quick Access

### Grafana Dashboard

**URL**: http://grafana.localhost

**Access**: No login required! Grafana is configured for anonymous access in local development.

**Optional Login** (for advanced features):
- Username: `admin`
- Password: `admin`

**First-time setup**:
1. Open http://grafana.localhost
2. You'll be automatically logged in as an anonymous admin
3. Grafana is pre-configured with Loki as the default datasource

### Viewing Logs in Grafana

1. **Navigate to Explore**:
   - Click on the "Explore" icon (compass) in the left sidebar
   - Or go directly to http://grafana.localhost/explore

2. **Select Loki datasource**:
   - Should be selected by default

3. **Query logs**:
   - Use LogQL (Loki Query Language) to filter logs
   - Click "Label browser" to see available labels

## Common Log Queries

### View All Logs from Store API

```logql
{service="store-api"}
```

### View All Logs from Warehouse Alpha

```logql
{service="warehouse-alpha"}
```

### View All Logs from Warehouse Beta

```logql
{service="warehouse-beta"}
```

### Filter by Log Level

```logql
{service="store-api"} |= "ERROR"
```

```logql
{service="warehouse-alpha"} |= "INFO"
```

### Search for Specific Text

```logql
{service="store-api"} |= "inventory reconciliation"
```

### Filter by Time Range

Use the time picker in the top-right corner of Grafana to select:
- Last 5 minutes
- Last 15 minutes
- Last 1 hour
- Last 24 hours
- Custom range

### Advanced Queries

**Count errors in the last hour**:
```logql
sum(count_over_time({service="store-api"} |= "ERROR" [1h]))
```

**Show only logs with specific fields**:
```logql
{service="store-api"} | json | warehouse="warehouse-alpha"
```

**Exclude health check logs**:
```logql
{service="store-api"} != "health check"
```

## Structured Logging with Pino

All application logs are structured as JSON with consistent fields.

### Log Levels

- `info`: General informational messages
- `warn`: Warning messages (non-critical)
- `error`: Error messages (requires attention)
- `debug`: Debug messages (only in development)

### Example Log Entry

```json
{
  "level": "INFO",
  "time": "2025-11-28T12:34:56.789Z",
  "service": "store-api",
  "environment": "production",
  "msg": "Reconciled inventory for warehouse",
  "warehouse": "warehouse-alpha"
}
```

### Using the Logger in Code

The logger is available in all services via `import { logger } from './logger'`.

**Basic logging**:
```typescript
import { logger } from './logger';

logger.info('Server started');
logger.error('Something went wrong');
```

**Logging with context (recommended)**:
```typescript
// Good: Structured data
logger.info({ orderId: '123', customerId: '456' }, 'Order created');

// Good: Error with context
logger.error({ error, orderId: '123' }, 'Failed to process order');

// Bad: String concatenation
logger.info(`Order ${orderId} created for customer ${customerId}`);
```

**Log Levels**:
```typescript
logger.debug('Debug information');
logger.info('Informational message');
logger.warn('Warning message');
logger.error('Error message');
logger.fatal('Fatal error');
```

## Configuration

### Environment Variables

The logger behavior is controlled by environment variables:

- `NODE_ENV`: Set to `production` for JSON logs, `development` for pretty-printed logs
- `LOG_LEVEL`: Minimum log level (default: `info`)
  - Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`

**Example** (in docker-compose.yaml):
```yaml
environment:
  NODE_ENV: production
  LOG_LEVEL: info
```

### Loki Configuration

Loki configuration is in `infra/loki/loki-config.yaml`:

- **Storage**: Filesystem (local)
- **Retention**: No automatic retention (manual cleanup required)
- **Access**: Via Traefik at http://loki.localhost (internal port 3100)

### Docker Logging Driver

Services are configured to send logs to Loki via the Docker Loki logging driver:

```yaml
logging:
  driver: loki
  options:
    loki-url: "http://loki.localhost/loki/api/v1/push"
    loki-batch-size: "400"
    labels: "service=store-api,environment=development"
```

**Note**: Logs are sent via Traefik at `loki.localhost` since Loki is not exposed on a direct port.

## Troubleshooting

### Cannot Access Grafana

**Check if Grafana is running**:
```bash
docker compose ps grafana
```

**View Grafana logs**:
```bash
docker compose logs grafana
```

**Restart Grafana**:
```bash
docker compose restart grafana
```

### No Logs Appearing in Loki

**Check if Loki is running**:
```bash
docker compose ps loki
```

**View Loki logs**:
```bash
docker compose logs loki
```

**Check service is sending logs**:
```bash
docker compose logs store-api
```

**Verify Loki is receiving logs**:
```bash
curl http://loki.localhost/loki/api/v1/labels
```

Should return available labels like:
```json
{
  "status": "success",
  "data": ["service", "environment"]
}
```

### Docker Loki Driver Not Available

If you get an error about the Loki logging driver not being available:

**Automated Setup (Recommended)**:
```bash
# Run the setup script
./scripts/setup-logging.sh

# Then restart services
docker compose down
docker compose up -d
```

**Manual Setup**:
1. **Install the Docker Loki driver**:
```bash
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
```

2. **Verify installation**:
```bash
docker plugin ls
```

Should show:
```
ID             NAME          ENABLED
xxxxx          loki:latest   true
```

3. **Restart Docker Compose**:
```bash
docker compose down
docker compose up -d
```

**Note**: The `./scripts/start.sh` script automatically runs the setup for you, so this is only needed if you're using `docker compose` directly.

### Logs Not Structured (Plain Text Instead of JSON)

**Check NODE_ENV**:
- Set to `production` for JSON logs
- Set to `development` for pretty-printed logs

**In docker-compose.yaml**:
```yaml
environment:
  NODE_ENV: production  # Forces JSON logging
```

### High Disk Usage from Loki

Loki stores logs in `/tmp/loki` inside the container (mapped to a Docker volume).

**Check disk usage**:
```bash
docker system df -v
```

**Clean up old logs** (stops containers and removes volumes):
```bash
docker compose down -v
docker compose up -d
```

**⚠️ WARNING**: This deletes all logs and database data!

## Best Practices

### 1. Always Use Structured Logging

**Good**:
```typescript
logger.info({ userId, orderId, amount }, 'Payment processed');
```

**Bad**:
```typescript
logger.info(`Payment processed for user ${userId}, order ${orderId}, amount ${amount}`);
```

### 2. Include Relevant Context

Always include relevant IDs and metadata:

```typescript
logger.error({
  error,
  orderId,
  warehouseName,
  bookId
}, 'Failed to ship order');
```

### 3. Use Appropriate Log Levels

- `info`: Normal operations (server started, job completed)
- `warn`: Unexpected but handled (API timeout with retry)
- `error`: Errors requiring attention (shipment failed)
- `debug`: Detailed debugging info (only in development)

### 4. Don't Log Sensitive Data

**Never log**:
- Passwords
- API keys
- Credit card numbers
- Personal information (emails, addresses, etc.)

**Good**:
```typescript
logger.info({ userId: user.id }, 'User authenticated');
```

**Bad**:
```typescript
logger.info({ email: user.email, password: user.password }, 'User authenticated');
```

### 5. Log Errors with Stack Traces

```typescript
try {
  await someOperation();
} catch (error) {
  logger.error({ error, orderId }, 'Operation failed');
  throw error;
}
```

## Maintenance

### Backing Up Logs

Logs are stored in Docker volumes. To back them up:

```bash
# Export logs from Loki
docker compose exec loki tar czf - /tmp/loki | gzip > loki-backup.tar.gz
```

### Rotating Logs

To configure log retention, update Loki configuration:

```yaml
# infra/loki/loki-config.yaml
limits_config:
  retention_period: 744h  # 31 days
```

Then restart Loki:
```bash
docker compose restart loki
```

## Additional Resources

- [Pino Documentation](https://getpino.io/)
- [Loki Documentation](https://grafana.com/docs/loki/latest/)
- [LogQL Documentation](https://grafana.com/docs/loki/latest/logql/)
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
