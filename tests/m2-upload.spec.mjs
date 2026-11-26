// M2 upload regression: a non-image file is rejected with a friendly message
// and does not break the editor. (HEIC, tiny and huge images: m5-polish.)
import { asymmetricImage } from './helpers/images.mjs';
import { test, expect, openEditor, getSchema, findByEffect, snap, uploadImage, setSlider } from './helpers/editor.mjs';

const invalidFiles = [
  { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('This is a text file, not a photo.\n') },
  { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('This is still text, despite the PNG name and type.\n') },
  { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
];

for (const file of invalidFiles) {
  test(`${file.name} is rejected with a friendly message, then a photo still opens`, async ({ page }) => {
    await openEditor(page);

    // setInputFiles bypasses the chooser's accept filter, like a drag and drop.
    await page.locator('#file').setInputFiles(file);
    const status = page.locator('#status');
    await expect(status).toHaveClass(/error/);
    await expect(status).toBeVisible();
    await expect(status).toContainText(/not supported/i);
    await expect(status).toContainText(/JPG, PNG or WebP/);
    await expect(status).toHaveText('That file is not supported. Please choose a JPG, PNG or WebP photo.');
    await expect(page.locator('#download')).toBeDisabled();
    await expect(page.locator('#format')).toBeDisabled();
    const inputs = page.locator('#panel input[type="range"]');
    const schema = await getSchema(page);
    await expect(inputs).toHaveCount(schema.SLIDERS.length);
    for (const input of await inputs.all()) await expect(input).toBeDisabled();
    await expect(page.locator('#view')).toBeHidden();

    // The editor still works: a valid photo opens and a slider can move.
    await uploadImage(page, asymmetricImage(), 'after-text.png');
    await expect(status).not.toHaveClass(/error/);
    await expect(page.locator('#view')).toBeVisible();
    const exposure = findByEffect(schema, 'lightStops');
    await setSlider(page, schema, exposure, snap(exposure, exposure.default + exposure.step));
  });
}
