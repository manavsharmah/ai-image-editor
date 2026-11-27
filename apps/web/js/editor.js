// Editor page: opening photos, the slider panel, the look prompt, and download.
// Photos stay in this browser. The only network request is the text prompt
// sent to /api/look; no image data, metadata or canvas content is ever sent.
import { SLIDERS, GROUPS, BANDS, DEFAULTS, clampLook, validateLook } from '../shared/look-schema.js';
import { createRenderer } from './renderer.js';
import { checkPhoto } from './photo-file.js';
import { initStatsDebug, showSource } from './stats-debug.js';

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
  const change = (value) => {
    cancelPrompt(); // a manual edit wins over a pending AI answer
    setLook({ ...look, [slider.name]: value });
  };
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
  showSource(bitmap); // synchronous, catches its own errors, never closes bitmap
  cancelPrompt();
  showPromptStatus('');
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

// --- Look prompt ------------------------------------------------------------

let promptRequest = 0; // id of the newest prompt; older answers are ignored
let promptAbort = null; // AbortController of the pending request, if any

function showPromptStatus(text, isError = false) {
  $('prompt-status').textContent = text; // always text, never HTML
  $('prompt-status').classList.toggle('error', isError);
}

function setPromptBusy(busy) {
  $('prompt-apply').disabled = busy;
  $('prompt-form').classList.toggle('busy', busy);
  $('prompt-form').setAttribute('aria-busy', String(busy));
}

// Drop any pending prompt (new photo, reset, manual edit, newer prompt).
function cancelPrompt() {
  if (!promptAbort) return;
  promptRequest++;
  promptAbort.abort();
  promptAbort = null;
  setPromptBusy(false);
  showPromptStatus('');
}

// Turns a server reply into { look, text } or { error }.
function readReply(status, data) {
  const usable = (status === 200 || status === 429)
    && data && (data.source === 'ai' || data.source === 'fallback')
    && validateLook(data.look).valid;
  if (!usable) {
    const error = status >= 400 && status < 500 && typeof data?.error === 'string'
      ? data.error
      : 'Could not get a look right now. Please try again.';
    return { error };
  }
  let text = 'Look applied. Fine-tune it with the sliders.';
  if (status === 429) text = 'Too many requests, so a simple keyword match was used. Try AI again in a minute.';
  else if (data.source === 'fallback') text = 'AI was unavailable, so a simple keyword match was used.';
  return { look: data.look, text };
}

async function applyPrompt(event) {
  event.preventDefault();
  if (!photo || promptAbort) return; // no photo yet, or already waiting
  const prompt = $('prompt').value.trim();
  if (!prompt) {
    showPromptStatus('Describe a look first, e.g. "warm and moody".', true);
    return;
  }
  const id = ++promptRequest;
  const controller = new AbortController();
  promptAbort = controller;
  setPromptBusy(true);
  showPromptStatus('Creating your look...');

  let reply;
  try {
    const response = await fetch('/api/look', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }), // text only
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    reply = readReply(response.status, data);
  } catch {
    reply = { error: 'Could not reach the server. Check your connection and try again.' };
  }
  if (id !== promptRequest) return; // superseded or cancelled meanwhile

  promptAbort = null;
  setPromptBusy(false);
  if (reply.error) {
    showPromptStatus(reply.error, true); // the current look is kept
    return;
  }
  setLook(reply.look);
  showPromptStatus(reply.text);
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
initStatsDebug();
$('reset').addEventListener('click', () => {
  cancelPrompt();
  setLook(DEFAULTS);
});
$('prompt-form').addEventListener('submit', applyPrompt);
$('download').addEventListener('click', download);
setLook(DEFAULTS);
try {
  renderer = createRenderer($('view'));
} catch (error) {
  for (const id of ['choose', 'drop']) $(id).disabled = true;
  showStatus(`The editor cannot run here. ${error.message}`, true);
}
