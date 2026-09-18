import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => {
  return c.text('Serverless Document Processing Pipeline');
});

export default app;
