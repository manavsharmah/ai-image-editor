// WebGL2 renderer: image + look -> adjusted image. Runs only in the browser.
import { SLIDERS, BANDS, CHANNELS, clampLook } from '../shared/look-schema.js';

const PREVIEW_MAX = 1600; // longest preview side, in pixels

// --- Shaders, generated from the schema -------------------------------------

const GLOBALS = SLIDERS.filter((s) => !s.band);
const BAND_SLIDERS = SLIDERS.filter((s) => s.band);
const uniformName = (slider) => `fx_${slider.effect}`;
const glslFloats = (numbers) => numbers.map((n) => n.toFixed(4)).join(', ');

// Distance in degrees from each band to the next one around the color wheel.
const BAND_GAPS = BANDS.map((b, i) =>
  (BANDS[(i + 1) % BANDS.length].hue - b.hue + 360) % 360);

// One triangle that covers the whole canvas. Image row 0 is the top, so y flips.
const VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); // (0,0) (2,0) (0,2)
  v_uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Each global slider becomes the uniform fx_<effect> (effect ids are in the
// schema). If an effect goes missing, the shader fails to compile.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
${GLOBALS.map((s) => `uniform float ${uniformName(s)};`).join('\n')}

const int BAND_COUNT = ${BANDS.length};
const float BAND_HUE[BAND_COUNT] = float[](${glslFloats(BANDS.map((b) => b.hue))});
const float BAND_GAP[BAND_COUNT] = float[](${glslFloats(BAND_GAPS)});
uniform vec3 u_bands[BAND_COUNT]; // hue, saturation, luminance per band

in vec2 v_uv;
out vec4 outColor;

// sRGB <-> linear light. Light-based math (exposure, white balance) must be
// done in linear; tone math looks better in sRGB, which is closer to vision.
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Perceived brightness (Rec. 709 weights: green looks brightest).
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgbToHsl(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float chroma = hi - lo;
  float l = (hi + lo) * 0.5;
  if (chroma < 1e-5) return vec3(0.0, 0.0, l);
  float s = chroma / max(1.0 - abs(2.0 * l - 1.0), 1e-5);
  float h;
  if (hi == c.r) h = mod((c.g - c.b) / chroma, 6.0);
  else if (hi == c.g) h = (c.b - c.r) / chroma + 2.0;
  else h = (c.r - c.g) / chroma + 4.0;
  return vec3(h * 60.0, s, l);
}
vec3 hslToRgb(vec3 hsl) {
  vec3 rgb = clamp(abs(mod(hsl.x / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
}

vec3 lightAndWhiteBalance(vec3 c) {
  c = toLinear(c);
  // Each stop doubles or halves the light.
  c *= exp2(fx_lightStops);
  // Warm = more red, less blue. Magenta tint = less green.
  vec3 gain = exp2(vec3(0.5 * fx_warmth, -0.5 * fx_magentaShift, -0.5 * fx_warmth));
  // Divide by the gain's brightness so white balance does not change exposure.
  return toSrgb(c * gain / luma(gain));
}

vec3 tone(vec3 c) {
  // Every weight is based on brightness, and the same offset is added to
  // r, g and b, so tones move without shifting color. The strengths are small
  // enough that dark tones never end up brighter than lighter ones.
  float y = clamp(luma(c), 0.0, 1.0);
  float inv = 1.0 - y;
  // Shadows / highlights: bumps peaking (at 1.0) at y = 1/3 and y = 2/3 that
  // leave pure black and pure white alone.
  c += 0.14 * fx_lowerTones * 6.75 * y * inv * inv;
  c += 0.14 * fx_upperTones * 6.75 * y * y * inv;
  // Blacks / whites: strongest at the ends, gone by mid gray.
  c += 0.15 * fx_blackEnd * (1.0 - smoothstep(0.0, 0.5, y));
  c += 0.15 * fx_whiteEnd * smoothstep(0.5, 1.0, y);
  // Contrast: push away from (or pull toward) mid gray.
  return (c - 0.5) * exp2(fx_toneSpread) + 0.5;
}

vec3 colorBands(vec3 c) {
  vec3 hsl = rgbToHsl(c);
  // Blend the two nearest bands: weight is 1 at a band's center and falls
  // linearly to 0 at its neighbors, so weights always add up to 1.
  vec3 adjust = vec3(0.0);
  for (int i = 0; i < BAND_COUNT; i++) {
    float d = mod(hsl.x - BAND_HUE[i] + 180.0, 360.0) - 180.0; // signed, -180..180
    float gap = d >= 0.0 ? BAND_GAP[i] : BAND_GAP[(i + BAND_COUNT - 1) % BAND_COUNT];
    adjust += u_bands[i] * max(0.0, 1.0 - abs(d) / gap);
  }
  // Near-gray pixels have an unreliable hue, so fade the effect out there.
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  adjust.xz *= smoothstep(0.0, 0.2, chroma);
  hsl.x += adjust.x * 30.0; // full slider = 30 degrees
  hsl.y = clamp(hsl.y * (1.0 + adjust.y), 0.0, 1.0);
  // Luminance: move up to halfway toward white or black.
  hsl.z = mix(hsl.z, step(0.0, adjust.z), abs(adjust.z) * 0.5);
  return hslToRgb(hsl);
}

vec3 globalColor(vec3 c) {
  // Vibrance is saturation that mostly affects muted colors.
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float muted = 1.0 - (hi - lo) / max(hi, 1e-5);
  float amount = (1.0 + fx_allColor) * (1.0 + fx_mutedColor * muted);
  // 0 = gray of the same brightness, 1 = unchanged, above 1 = more color.
  return mix(vec3(luma(c)), c, amount);
}

void main() {
  vec4 pixel = texture(u_image, v_uv);
  // Values may leave 0..1 until tone() is done, so highlights pushed past
  // white by exposure can still be pulled back.
  vec3 c = clamp(tone(lightAndWhiteBalance(pixel.rgb)), 0.0, 1.0);
  c = globalColor(colorBands(c));
  outColor = vec4(clamp(c, 0.0, 1.0), pixel.a);
}`;

// --- WebGL plumbing ---------------------------------------------------------

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

// Schema value -> shader amount: "stops" stay as they are, everything else
// becomes -1..1 with the schema default at 0.
function toAmount(slider, value) {
  if (slider.unit === 'stops') return value;
  const offset = value - slider.default;
  return offset >= 0
    ? offset / (slider.max - slider.default || 1)
    : offset / (slider.default - slider.min || 1);
}

// One GL program + texture on one canvas. Used for preview and for export.
function createEngine(canvas) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader error: ${gl.getShaderInfoLog(vertex) || ''}
${gl.getShaderInfoLog(fragment) || ''}
${gl.getProgramInfoLog(program) || ''}`);
  }
  gl.useProgram(program);

  const locations = new Map(GLOBALS.map((s) =>
    [s.name, gl.getUniformLocation(program, uniformName(s))]));
  const bandsLocation = gl.getUniformLocation(program, 'u_bands');
  const bandValues = new Float32Array(BANDS.length * CHANNELS.length);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); // u_image defaults to unit 0
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    setSource(source) {
      const { width, height } = source;
      const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      canvas.width = width;
      canvas.height = height;
      // The browser may silently give a smaller buffer than requested.
      if (width > Math.min(limit, viewport[0]) || height > Math.min(limit, viewport[1])
        || gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
        throw new Error(`Image is too large for this device (${width}x${height}).`);
      }
      gl.viewport(0, 0, width, height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not load the image into WebGL.');
    },
    draw(look) {
      const safe = clampLook(look);
      for (const s of GLOBALS) gl.uniform1f(locations.get(s.name), toAmount(s, safe[s.name]));
      for (const s of BAND_SLIDERS) {
        const band = BANDS.findIndex((b) => b.name === s.band);
        const channel = CHANNELS.indexOf(s.channel);
        bandValues[band * CHANNELS.length + channel] = toAmount(s, safe[s.name]);
      }
      gl.uniform3fv(bandsLocation, bandValues);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    isLost: () => gl.isContextLost(),
    // Free GPU memory now instead of waiting for garbage collection.
    dispose: () => gl.getExtension('WEBGL_lose_context')?.loseContext(),
  };
}

// Shrink to preview size. Never enlarges.
function makePreview(image) {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(image.width, image.height));
  const preview = document.createElement('canvas');
  preview.width = Math.max(1, Math.round(image.width * scale));
  preview.height = Math.max(1, Math.round(image.height * scale));
  const ctx = preview.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, preview.width, preview.height);
  return preview;
}

// --- Public API -------------------------------------------------------------

// Draws a live preview into `canvas`.
//   setImage(image)  ImageBitmap or canvas. Keep it open: export needs it.
//   render(look)     draws on the next frame; cheap to call on every input
//   exportBlob(look, type, quality)  full-resolution Blob
export function createRenderer(canvas) {
  let engine = createEngine(canvas);
  let image = null;
  let preview = null;
  let look = {};
  let frame = 0;

  function drawNow() {
    frame = 0;
    if (preview && !engine.isLost()) engine.draw(look);
  }
  function requestDraw() {
    frame ||= requestAnimationFrame(drawNow); // at most one draw per frame
  }

  // Phones may drop the GL context in the background. Rebuild when it returns.
  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    engine = createEngine(canvas);
    if (preview) engine.setSource(preview);
    requestDraw();
  });

  return {
    setImage(newImage) {
      const newPreview = makePreview(newImage);
      if (!engine.isLost()) engine.setSource(newPreview);
      image = newImage;
      preview = newPreview;
      requestDraw();
    },
    render(newLook) {
      look = clampLook(newLook);
      requestDraw();
    },
    // Uses a temporary canvas so the preview stays small and does not flicker.
    async exportBlob(exportLook, type = 'image/jpeg', quality = 0.92) {
      if (!image) throw new Error('No image loaded.');
      const exportCanvas = document.createElement('canvas');
      const exporter = createEngine(exportCanvas);
      try {
        exporter.setSource(image);
        exporter.draw(exportLook);
        if (exporter.isLost()) throw new Error('The GPU ran out of memory.');
        // toBlob must follow draw in the same task, before the buffer clears.
        const blob = await new Promise((done) => exportCanvas.toBlob(done, type, quality));
        if (!blob) throw new Error('Could not encode the image.');
        return blob;
      } finally {
        exporter.dispose();
      }
    },
  };
}
