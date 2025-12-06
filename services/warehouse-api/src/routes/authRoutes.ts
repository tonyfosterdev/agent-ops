import Router from 'koa-router';
import { Context } from 'koa';
import { AuthService } from '../services/authService';

const router = new Router({ prefix: '/auth' });
const authService = new AuthService();

router.post('/register', async (ctx: Context) => {
  const { email, password } = ctx.request.body as any;

  const user = await authService.register(email, password);

  ctx.status = 201;
  ctx.body = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
});

router.post('/login', async (ctx: Context) => {
  const { email, password } = ctx.request.body as any;

  const user = await authService.login(email, password);

  ctx.body = {
    id: user.id,
    email: user.email,
    role: user.role,
    message: 'Use Basic Auth with email:password for subsequent requests',
  };
});

export default router;
