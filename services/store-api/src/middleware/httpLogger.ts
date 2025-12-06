import { Context, Next } from 'koa';
import { logger } from '../logger';

/**
 * HTTP request logging middleware with structured logging
 * Logs: method, path, status, duration, user info (redacts auth)
 */
export async function httpLogger(ctx: Context, next: Next): Promise<void> {
  const start = Date.now();
  let errorOccurred = false;

  try {
    await next();
  } catch (err) {
    // Mark that an error occurred, then re-throw
    // The errorHandler middleware will handle logging with proper status code
    errorOccurred = true;
    throw err;
  } finally {
    // Only log successful requests and client errors (4xx)
    // Let errorHandler middleware handle server errors (5xx) for proper status and stack traces
    if (!errorOccurred) {
      const duration = Date.now() - start;

      // Extract user info (from basic auth or state)
      const user = ctx.state.user?.email || 'anonymous';

      // Determine if request was successful
      const success = ctx.status < 400;

      // Build log context
      const logContext = {
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        duration,
        user,
        success,
        ip: ctx.ip,
        userAgent: ctx.get('user-agent'),
        // Add query params for GET requests
        ...(ctx.method === 'GET' && Object.keys(ctx.query).length > 0 && { query: ctx.query }),
        // Add error message if request failed
        ...(ctx.status >= 400 && (ctx.body as any)?.error?.message && { error: (ctx.body as any).error.message }),
      };

      // Log at appropriate level
      if (success) {
        logger.info(logContext, 'HTTP request completed');
      } else {
        // Client errors (4xx)
        logger.warn(logContext, 'HTTP request completed with client error');
      }
    }
  }
}
