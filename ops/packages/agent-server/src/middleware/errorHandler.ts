import { Context, Next } from 'hono';
import { logger } from '../config';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error: any) {
    logger.error({
      path: c.req.path,
      method: c.req.method,
      error: error.message,
      stack: error.stack,
    }, 'Request error');

    return c.json(
      {
        error: 'Internal server error',
        message: error.message,
      },
      500
    );
  }
}
