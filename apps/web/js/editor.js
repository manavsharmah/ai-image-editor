// Editor page: opening photos, the slider panel, and download.
// Photos stay in this browser; nothing here makes a network request.
import { SLIDERS, GROUPS, BANDS, DEFAULTS, clampLook } from '../shared/look-schema.js';
import { createRenderer } from './renderer.js';
import { checkPhoto } from './photo-file.js';

const $ = (id) => document.getElementById(id);
const controls = []; // { slider, input, output } for every slider
let look = { ...DEFAULTS };
let photo = null; // { bitmap, name } of the open photo
let latestLoad = 0; // lets us ignore slow loads that finish out of order
let renderer;

function showStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

// --- Look and sliders -------------------------------------------------------

// Apply a look to the sliders and preview. Missing sliders become default.
export function setLook(newLook) {
  look = clampLook(newLook);
  controls.forEach(showValue);
  renderer?.render(look);
}

function showValue({ slider, input, output }) {
  const value = look[slider.name];
  const decimals = (String(slider.step).split('.')[1] ?? '').length;
  input.value = value;
  output.textContent = Number(value.toFixed(decimals)) || 0; // "|| 0" avoids "-0"
}

function createRow(slider) {
  const row = document.createElement('label');
  const input = document.createElement('input');
  const output = document.createElement('output');
  row.className = 'row';
  // min, max and step must be set before value, or the value gets limited.
  Object.assign(input, { type: 'range', min: slider.min, max: slider.max, step: slider.step });
  input.autocomplete = 'off'; // do not restore old positions on page reload
  const change = (value) => setLook({ ...look, [slider.name]: value });
  input.addEventListener('input', () => change(input.valueAsNumber));
  input.addEventListener('dblclick', () => change(slider.default));
  row.append(slider.label, input, output);
  controls.push({ slider, input, output });
  return row;
}

function buildPanel() {
  for (const group of GROUPS) {
    const section = document.createElement('section');
    const title = document.createElement('h2');
    const sliders = SLIDERS.filter((s) => s.group === group);
    title.textContent = group;
    section.append(title, ...sliders.filter((s) => !s.band).map(createRow));
    for (const band of BANDS) {
      const bandSliders = sliders.filter((s) => s.band === band.name);
      if (!bandSliders.length) continue;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = band.label;
      details.append(summary, ...bandSliders.map(createRow));
      section.append(details);
    }
    $('sliders').append(section);
  }
}

// --- Opening a photo --------------------------------------------------------

async function openPhoto(file) {
  if (!renderer) return; // no WebGL2: that message stays on screen
  const load = ++latestLoad;
  let bitmap;
  try {
    showStatus('Opening photo...');
    const problem = await checkPhoto(file);
    if (load !== latestLoad) return;
    if (problem) {
      showStatus(problem, true);
      return;
    }
    // WebGL wants straight alpha; premultiplied would darken see-through pixels.
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none' });
    if (load !== latestLoad) {
      bitmap.close();
      return;
    }
    renderer.setImage(bitmap); // replaces the old preview texture
  } catch {
    bitmap?.close();
    if (load === latestLoad) {
      showStatus('Could not open that photo. It may be damaged or too large.', true);
    }
    return;
  }

  photo?.bitmap.close(); // free the previous photo now
  photo = { bitmap, name: file.name.replace(/\.[^.]*$/, '') || 'photo' };
  setLook(DEFAULTS);
  $('view').hidden = false;
  $('drop').hidden = true;
  for (const id of ['panel', 'format', 'download']) $(id).disabled = false;
  showStatus(`${file.name} (${bitmap.width} x ${bitmap.height})`);
}

function setUpOpening() {
  for (const id of ['choose', 'drop']) $(id).addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => {
    const [file] = $('file').files;
    $('file').value = ''; // so the same file can be chosen again
    if (file) openPhoto(file);
  });

  // Listen on the whole window, so a near miss does not navigate to the file.
  const hasFiles = (event) => event.dataTransfer?.types.includes('Files');
  const highlight = (on) => document.body.classList.toggle('dragging', on);
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    highlight(true);
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) highlight(false); // left the window
  });
  window.addEventListener('drop', (event) => {
    highlight(false);
    if (!hasFiles(event)) return;
    event.preventDefault();
    const [file] = event.dataTransfer.files;
    if (file) openPhoto(file);
  });
}

// --- Download ---------------------------------------------------------------

async function download() {
  const { name } = photo; // another photo may be opened while this one encodes
  const type = $('format').value;
  const load = latestLoad;
  const report = (text, isError) => {
    if (load === latestLoad) showStatus(text, isError);
  };
  $('download').disabled = true;
  report('Preparing download...');
  try {
    const blob = await renderer.exportBlob(look, type, 0.95);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${name}-edited.${type === 'image/png' ? 'png' : 'jpg'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    report('Photo downloaded.');
  } catch (error) {
    report(`Download failed. ${error.message}`, true);
  } finally {
    $('download').disabled = false;
  }
}

// --- Start ------------------------------------------------------------------

buildPanel();
setUpOpening();
$('reset').addEventListener('click', () => setLook(DEFAULTS));
$('download').addEventListener('click', download);
setLook(DEFAULTS);
try {
  renderer = createRenderer($('view'));
} catch (error) {
  for (const id of ['choose', 'drop']) $(id).disabled = true;
  showStatus(`The editor cannot run here. ${error.message}`, true);
}
