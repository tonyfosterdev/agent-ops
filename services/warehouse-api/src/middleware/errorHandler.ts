import { Context, Next } from 'koa';
import { logger } from '../logger';

export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (err: any) {
    ctx.status = err.status || 500;
    ctx.body = {
      error: {
        message: err.message || 'Internal server error',
        status: ctx.status,
      },
    };

    if (ctx.status === 500) {
      // Extract user email if available (set by basicAuth middleware)
      const user = ctx.state.user?.email || 'anonymous';

      // Format error with explicit stack trace for Loki
      const errorContext = {
        error: {
          message: err.message,
          stack: err.stack,
          name: err.name,
        },
        path: ctx.path,
        method: ctx.method,
        user,
        status: ctx.status,
      };

      logger.error(errorContext, 'Internal server error');
    }

    // Note: Removed ctx.app.emit('error', err, ctx) to prevent duplicate logging
    // Koa's default error listener would log to stderr, causing line-by-line stack traces
  }
}
