// node:test regression for model output parsing (run: node --test tests/).
// Goes through the real Hono app with a stubbed AI binding: only a complete
// JSON object may be used as an AI look; anything else must fall back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../apps/api/src/index.js';

function envWith(response) {
  return {
    AI: { run: async () => ({ response }) },
    LOOK_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

async function post(response) {
  const res = await app.request('/api/look', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'warm sunset' }),
  }, envWith(response));
  return res.json();
}

for (const bad of [
  '[{"exposure":1}]',
  'junk {"exposure":1}',
  '{"exposure":1} trailing',
  '{"exposure":1}{"contrast":2}',
  '1',
  'null',
  '',
]) {
  test(`falls back for ${JSON.stringify(bad)}`, async () => {
    assert.equal((await post(bad)).source, 'fallback');
  });
}

for (const good of ['{"exposure":1}', '  {"exposure":1}\n', '```json\n{"exposure":1}\n```']) {
  test(`accepts ${JSON.stringify(good)}`, async () => {
    const body = await post(good);
    assert.equal(body.source, 'ai');
    assert.equal(body.look.exposure, 1);
  });
}
