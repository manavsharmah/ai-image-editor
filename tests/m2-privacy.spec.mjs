// M2 privacy regression: opening, editing and downloading a photo makes no
// network request that carries image data. Every request is observed from
// before the first navigation; nothing is mocked.
import { asymmetricImage } from './helpers/images.mjs';
import {
  test, expect, openEditor, getSchema, findByEffect, snap, uploadImage, setSlider, downloadPng,
} from './helpers/editor.mjs';

// The static files the editor page loads in the M2 flow. Body-less GETs only.
// favicon.ico is requested by the browser itself.
const STATIC_PATHS = new Set([
  '/',
  '/css/styles.css',
  '/js/editor.js',
  '/js/renderer.js',
  '/js/photo-file.js',
  '/shared/look-schema.js',
  '/favicon.ico',
]);

// Markers of image data in text: PNG and JPEG base64 starts, and data URLs.
const IMAGE_TEXT = [/iVBORw0KGgo/, /\/9j\//, /data:image/i];

test('no network request carries image data', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const requests = [];
  const sockets = [];
  // Start reading headers immediately; keep the listener active through teardown.
  context.on('request', (request) => requests.push({ request, headers: request.allHeaders() }));
  page.on('websocket', (socket) => sockets.push(socket.url()));

  await openEditor(page);
  const schema = await getSchema(page);
  const photo = await uploadImage(page, asymmetricImage(), 'private.png');
  const exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + (exposure.max - exposure.default) / 5));
  await downloadPng(page);
  await page.waitForLoadState('networkidle');

  // Include compressed pixel data beyond the generic PNG/IHDR header.
  const photoBase64 = photo.toString('base64').slice(0, 256);
  expect(photoBase64.length).toBe(256);
  const idat = photo.indexOf(Buffer.from('IDAT'));
  expect(idat).toBeGreaterThan(0);
  expect(Buffer.from(photoBase64, 'base64').length).toBeGreaterThan(idat + 32);
  const problems = [];
  for (const observed of requests) {
    const { request } = observed;
    const url = new URL(request.url());
    const label = `${request.method()} ${request.url()}`;
    const body = request.postDataBuffer();
    const headers = await observed.headers;
    const text = [request.url(), ...Object.entries(headers).flat()].join('\n');

    if (body !== null) problems.push(`${label}: has a ${body.length}-byte body`);
    if (body?.includes(photo)) problems.push(`${label}: body contains the photo bytes`);
    if (text.includes(photoBase64) || IMAGE_TEXT.some((re) => re.test(text))) {
      problems.push(`${label}: URL or headers contain image data`);
    }
    if (url.search || url.hash) problems.push(`${label}: unexpected query string or hash`);
    // The download is a local same-origin blob: URL, not an HTTP upload.
    if (url.protocol === 'blob:') {
      if (request.method() !== 'GET' || !request.url().startsWith(`blob:${origin}/`)) {
        problems.push(`${label}: unexpected blob request`);
      }
      continue;
    }
    if (url.origin !== origin) problems.push(`${label}: unexpected destination`);
    else if (request.method() !== 'GET') problems.push(`${label}: unexpected method`);
    else if (!STATIC_PATHS.has(url.pathname)) problems.push(`${label}: not a known static file`);
  }

  expect(problems).toEqual([]);
  expect(sockets, 'WebSocket connections').toEqual([]);
  // Observation really ran: the page and its main script were seen.
  const paths = requests.map(({ request }) => new URL(request.url()).pathname);
  expect(paths).toContain('/');
  expect(paths).toContain('/js/editor.js');
});
