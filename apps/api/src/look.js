// POST /api/look: text prompt -> look. The server only ever sees text.
// Model output is untrusted: it is parsed, strictly validated, then clamped.
// Anything unusable falls back to the keyword matcher.
import { SLIDERS, DEFAULTS, clampLook, validateLook } from '../../web/shared/look-schema.js';
import { keywordLook } from './keyword-look.js';

// Workers AI text-generation model.
// Docs: https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
// Input: { messages, max_tokens, temperature }. Non-streaming output: { response }.
export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_PROMPT_LENGTH = 300;
export const AI_TIMEOUT_MS = 8000;
const MAX_TOKENS = 300;
const MAX_BODY_LENGTH = 4096; // a 300-char prompt in JSON never needs more
const MAX_RAW_BODY_LENGTH = MAX_BODY_LENGTH * 4; // bytes, before decoding

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// --- Request ----------------------------------------------------------------

// Returns { prompt } (trimmed, capped) or { status, error }.
export async function readPrompt(req) {
  const type = (req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return { status: 415, error: 'Send the prompt as JSON.' };
  }
  const length = Number(req.header('Content-Length'));
  if (length > MAX_RAW_BODY_LENGTH) return { status: 413, error: 'That request is too large.' };

  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_LENGTH) return { status: 413, error: 'That request is too large.' };
    body = JSON.parse(text);
  } catch {
    return { status: 400, error: 'That request was not valid JSON.' };
  }
  const keys = isObject(body) ? Object.keys(body) : [];
  if (keys.length !== 1 || keys[0] !== 'prompt' || typeof body.prompt !== 'string') {
    return { status: 400, error: 'Send exactly one field: a text "prompt".' };
  }
  const prompt = body.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!prompt) return { status: 400, error: 'Describe the look you want first.' };
  return { prompt };
}

// --- Rate limit -------------------------------------------------------------

// Returns 'ok', 'denied' or 'unavailable'. The Workers rate limit binding is
// approximate and counted separately in each Cloudflare location.
export async function checkLimit(env, req) {
  // CF-Connecting-IP is set by Cloudflare and cannot be spoofed by clients.
  // It is absent in local dev, where everyone shares one key.
  const ip = req.header('CF-Connecting-IP') || 'local';
  try {
    const { success } = await env.LOOK_RATE_LIMITER.limit({ key: `/api/look:${ip}` });
    return success === true ? 'ok' : 'denied';
  } catch {
    return 'unavailable'; // missing or broken binding: never call AI unlimited
  }
}

// --- Model ------------------------------------------------------------------

// System instructions are generated from the schema, never a second list.
export function buildInstructions() {
  const lines = SLIDERS.map((s) => {
    const what = s.band ? `${s.band} color band ${s.channel.toLowerCase()}` : `${s.label} (${s.effect})`;
    const unit = s.unit ? ` ${s.unit}` : '';
    return `- ${s.name}: ${what}, ${s.min} to ${s.max}${unit}, default ${s.default}`;
  });
  return [
    'You set photo editing sliders for the look a user describes.',
    'Only adjust exposure, tone and color. Never describe or change image content.',
    'Reply with ONLY a flat JSON object mapping slider names to numbers, no text or code fences.',
    'Include only sliders you change; omitted sliders stay at their default.',
    'Keep every value inside its range. Prefer subtle, natural adjustments.',
    'Sliders:',
    ...lines,
  ].join('\n');
}

// Pulls a JSON object out of the documented `response` field without
// executing anything. Returns the parsed value or null.
export function extractModelJson(result) {
  const response = result?.response;
  if (isObject(response)) return response; // some models return parsed JSON
  if (typeof response !== 'string') return null;
  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(response.slice(start, end + 1));
  } catch {
    return null;
  }
}

// One bounded inference attempt. Returns a complete valid look or null.
export async function askModel(env, prompt, timeoutMs = AI_TIMEOUT_MS) {
  if (typeof env?.AI?.run !== 'function') return null;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    const result = await Promise.race([
      env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: buildInstructions() },
          { role: 'user', content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
      }),
      timeout,
    ]);
    const candidate = extractModelJson(result);
    // Validate BEFORE clamping, or clamping would hide bad output.
    if (!validateLook(candidate).valid) return null;
    return finalLook(candidate);
  } catch {
    return null; // errors, quota exhaustion and timeouts all fall back
  } finally {
    clearTimeout(timer);
  }
}

// --- Handler ----------------------------------------------------------------

// Every look leaves the server complete, clamped and validated.
function finalLook(look) {
  const full = clampLook(look);
  return validateLook(full).valid ? full : { ...DEFAULTS };
}

export async function handleLook(c) {
  const env = c.env ?? {};
  const request = await readPrompt(c.req);
  if (request.error) return c.json({ error: request.error }, request.status);
  const { prompt } = request;
  const fallback = () => ({ look: finalLook(keywordLook(prompt)), source: 'fallback' });

  const limit = await checkLimit(env, c.req);
  if (limit === 'denied') {
    c.header('Retry-After', '60');
    return c.json({
      ...fallback(),
      message: 'Too many requests. A simple keyword match was used instead.',
    }, 429);
  }
  if (limit === 'ok') {
    const look = await askModel(env, prompt);
    if (look) return c.json({ look, source: 'ai' });
  }
  return c.json(fallback());
}
