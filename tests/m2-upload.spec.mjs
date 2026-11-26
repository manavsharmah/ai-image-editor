// M2 upload regression: a non-image file is rejected with a friendly message
// and does not break the editor. (HEIC, tiny and huge images: m5-polish.)
import { asymmetricImage } from './helpers/images.mjs';
import { test, expect, openEditor, getSchema, findByEffect, snap, uploadImage, setSlider } from './helpers/editor.mjs';

test('non-image file shows a friendly message, then a photo still opens', async ({ page }) => {
  await openEditor(page);

  // setInputFiles bypasses the chooser's accept filter, like a drag and drop.
  await page.locator('#file').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('This is a text file, not a photo.\n'),
  });
  const status = page.locator('#status');
  await expect(status).toHaveClass(/error/);
  await expect(status).toBeVisible();
  await expect(status).toContainText(/not supported/i);
  await expect(status).toContainText(/JPG, PNG or WebP/);
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#format')).toBeDisabled();
  await expect(page.locator('#panel input[type="range"]').first()).toBeDisabled();
  await expect(page.locator('#view')).toBeHidden();

  // The editor still works: a valid photo opens and a slider can move.
  await uploadImage(page, asymmetricImage(), 'after-text.png');
  await expect(status).not.toHaveClass(/error/);
  await expect(page.locator('#view')).toBeVisible();
  const schema = await getSchema(page);
  const exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + exposure.step));
});
