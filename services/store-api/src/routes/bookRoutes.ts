import Router from 'koa-router';
import { Context } from 'koa';
import { BookService } from '../services/bookService';
import { basicAuth, requireRole } from '../middleware/basicAuth';
import { UserRole } from '@agentops/shared';

const router = new Router({ prefix: '/books' });
const bookService = new BookService();

router.get('/', async (ctx: Context) => {
  const books = await bookService.listBooks();
  // Ensure price is a number and map total_inventory to availableStock for frontend
  ctx.body = books.map(book => ({
    ...book,
    price: parseFloat(String(book.price)),
    availableStock: book.total_inventory
  }));
});

router.get('/:id', async (ctx: Context) => {
  const book = await bookService.getBook(ctx.params.id);
  if (!book) {
    ctx.status = 404;
    ctx.body = { error: 'Book not found' };
    return;
  }
  ctx.body = book;
});

router.post('/', basicAuth, requireRole(UserRole.STORE_ADMIN), async (ctx: Context) => {
  const book = await bookService.createBook(ctx.request.body as any);
  ctx.status = 201;
  ctx.body = book;
});

router.put('/:id', basicAuth, requireRole(UserRole.STORE_ADMIN), async (ctx: Context) => {
  const book = await bookService.updateBook(ctx.params.id, ctx.request.body as any);
  if (!book) {
    ctx.status = 404;
    ctx.body = { error: 'Book not found' };
    return;
  }
  ctx.body = book;
});

router.delete('/:id', basicAuth, requireRole(UserRole.STORE_ADMIN), async (ctx: Context) => {
  await bookService.deleteBook(ctx.params.id);
  ctx.status = 204;
});

export default router;
