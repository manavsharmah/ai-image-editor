import { Hono } from 'hono';
import { handleLook } from './look.js';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));
app.post('/api/look', handleLook);

export default app;
