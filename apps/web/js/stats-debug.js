// Debug panel: the source photo and a reference photo side by side, each with
// its image statistics. Everything stays in this browser; nothing is uploaded.
import { BANDS } from '../shared/look-schema.js';
import { sampleImage } from './stats.js';
import { checkPhoto } from './photo-file.js';

const $ = (id) => document.getElementById(id);
let referenceLoad = 0; // newest reference selection; older results are ignored

const fixed = (value, digits) => Number(value.toFixed(digits)) || 0; // "|| 0" avoids "-0"

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setMessage(slot, text, isError = false) {
  const message = $(slot).querySelector('.stats-msg');
  message.textContent = text;
  message.classList.toggle('error', isError);
}

// Shows a sampled { canvas, stats } in a slot, or the empty state for null.
function showResult(slot, result) {
  const body = $(slot).querySelector('.stats-body');
  if (!result) {
    body.replaceChildren(element('p', 'No image loaded.', 'stats-empty'));
    return;
  }
  const { canvas, stats } = result;
  const { mean, std } = stats.lab;
  const { p5, p50, p95 } = stats.luminance;
  canvas.className = 'stats-thumb';
  const rows = [
    ['Sample', `${stats.width} x ${stats.height}`],
    ['Lab mean', `${fixed(mean.L, 1)} / ${fixed(mean.a, 1)} / ${fixed(mean.b, 1)}`],
    ['Lab std', `${fixed(std.L, 1)} / ${fixed(std.a, 1)} / ${fixed(std.b, 1)}`],
    ['Lum p5/50/95', `${fixed(p5, 3)} / ${fixed(p50, 3)} / ${fixed(p95, 3)}`],
    ['Saturation', String(fixed(stats.saturation, 3))],
  ];
  const list = element('dl', undefined, 'stats-list');
  for (const [term, value] of rows) list.append(element('dt', term), element('dd', value));

  const table = element('table', undefined, 'stats-bands');
  const head = element('tr');
  for (const title of ['Band', 'Sat', 'Lum', 'Weight']) head.append(element('th', title));
  table.append(head);
  for (const band of BANDS) {
    const { saturation, luminance, weight } = stats.bands[band.name];
    const row = element('tr');
    row.append(element('th', band.label));
    if (weight > 0) {
      row.append(
        element('td', String(fixed(saturation, 3))),
        element('td', String(fixed(luminance, 3))),
        element('td', String(fixed(weight, 1))),
      );
    } else {
      const none = element('td', 'no samples', 'stats-none');
      none.colSpan = 3;
      row.append(none);
    }
    table.append(row);
  }
  body.replaceChildren(canvas, list, table);
}

// Called by the editor with its newly opened bitmap. Samples synchronously
// while the bitmap is valid and never closes it (the editor owns it).
export function showSource(bitmap) {
  try {
    showResult('stats-source', sampleImage(bitmap));
    setMessage('stats-source', '');
  } catch {
    showResult('stats-source', null); // never leave stats of the old photo
    setMessage('stats-source', 'Could not measure this photo.', true);
  }
}

async function openReference(file) {
  const load = ++referenceLoad;
  let bitmap;
  try {
    setMessage('stats-reference', 'Reading reference...');
    const problem = await checkPhoto(file);
    if (load !== referenceLoad) return;
    if (problem) {
      setMessage('stats-reference', problem, true); // the previous reference stays
      return;
    }
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none' });
    if (load !== referenceLoad) return;
    const result = sampleImage(bitmap);
    showResult('stats-reference', result);
    setMessage('stats-reference', '');
  } catch {
    if (load === referenceLoad) {
      setMessage('stats-reference', 'Could not open that reference. It may be damaged or too large.', true);
    }
  } finally {
    bitmap?.close(); // only the small sample canvas is kept
  }
}

export function initStatsDebug() {
  showResult('stats-source', null);
  showResult('stats-reference', null);
  const input = $('reference-file');
  $('choose-reference').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const [file] = input.files;
    input.value = ''; // so the same file can be chosen again
    if (file) openReference(file);
  });
}
