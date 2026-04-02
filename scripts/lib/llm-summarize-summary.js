/**
 * Shorten long text with ChatGPT (OpenAI) or Gemini, or mechanical truncation.
 * Use for playlist summaries, descriptions, artist bios, curatorial notes, etc.
 */

export const DEFAULT_MAX_TEXT_LENGTH = 2000;

/** @deprecated Use DEFAULT_MAX_TEXT_LENGTH — kept for existing imports */
export const MAX_SUMMARY_LENGTH = DEFAULT_MAX_TEXT_LENGTH;

const ELLIPSIS = '...';

function contentMaxFor(maxLength) {
  return maxLength - ELLIPSIS.length;
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 */
export function mechanicalTruncate(text, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) return text;
  return text.substring(0, contentMaxFor(maxLength)) + ELLIPSIS;
}

/** @deprecated Use mechanicalTruncate */
export function mechanicalTruncateSummary(text) {
  return mechanicalTruncate(text, DEFAULT_MAX_TEXT_LENGTH);
}

export function stripModelNoise(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return t.trim();
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 */
export function hardTruncateAtWord(text, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) return text;
  const cap = contentMaxFor(maxLength);
  const slice = text.slice(0, cap);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > cap * 0.35) {
    return slice.slice(0, lastSpace).trimEnd() + ELLIPSIS;
  }
  return slice + ELLIPSIS;
}

/**
 * @param {number} maxLength
 */
export function buildSystemPrompt(maxLength) {
  return [
    'You shorten long-form text for arts and exhibitions: playlist summaries, descriptions, artist bios, curatorial or series notes, wall labels, etc.',
    'Rules:',
    "- Preserve the author's or artist's intent, voice, and framing. Do not flatten nuance into generic marketing copy.",
    '- Do not invent facts: names, dates, titles, technical claims, quotes, and URLs must only appear if they are in the original (you may omit details to save space).',
    '- If the original contains HTML tags, keep valid HTML and preserve emphasis/links where they matter; do not introduce new tags that change meaning.',
    '- If the original is plain text, output plain text only.',
    `- The final text must be at most ${maxLength} characters (count every character including HTML tags and spaces).`,
    "- Output only the shortened text: no preamble, no title line, no bullet labels like 'Summary:', no surrounding quotes.",
  ].join('\n');
}

/**
 * @param {SummarizeContext} context
 * @param {string} original
 * @param {number} maxLength
 */
function buildUserPrompt(context, original, maxLength) {
  const lines = [];
  if (context.kind) {
    lines.push(`Content kind: ${context.kind}`);
  }
  if (context.subject) {
    lines.push(`Subject: ${context.subject}`);
  }
  if (context.labels && typeof context.labels === 'object') {
    for (const [k, v] of Object.entries(context.labels)) {
      if (v != null && String(v) !== '') {
        lines.push(`${k}: ${v}`);
      }
    }
  }
  lines.push(
    `Original length: ${original.length} characters (target max after editing: ${maxLength}).`
  );
  lines.push('');
  lines.push('Original text:');
  lines.push(original);
  return lines.join('\n');
}

async function openAIChatComplete({ apiKey, baseUrl, model }, messages) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 8192,
      messages,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${raw.slice(0, 500)}`);
  }
  const json = JSON.parse(raw);
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('No assistant message content in OpenAI response');
  }
  return stripModelNoise(content);
}

async function geminiGenerateContent({ apiKey, baseUrl, model }, { systemText, contents }) {
  const b = baseUrl.replace(/\/$/, '');
  const path = `${b}/models/${encodeURIComponent(model)}:generateContent`;
  const url = `${path}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    ...(systemText
      ? {
          systemInstruction: { parts: [{ text: systemText }] },
        }
      : {}),
    contents,
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 8192,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${raw.slice(0, 500)}`);
  }
  const json = JSON.parse(raw);
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked prompt: ${json.promptFeedback.blockReason}`);
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    const fr = json.candidates?.[0]?.finishReason;
    throw new Error(`No text in Gemini response (finish: ${fr ?? 'unknown'})`);
  }
  return stripModelNoise(text);
}

/**
 * @param {{ apiKey: string; baseUrl: string; model: string }} ctx
 * @param {SummarizeContext} context
 * @param {string} original
 * @param {number} maxLength
 */
async function summarizeOnceOpenAI(ctx, context, original, maxLength) {
  const user = buildUserPrompt(context, original, maxLength);
  const system = buildSystemPrompt(maxLength);

  const text = await openAIChatComplete(ctx, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  if (text.length <= maxLength) return text;

  const retryUser = [
    `Your previous answer was ${text.length} characters, which exceeds the limit of ${maxLength}.`,
    'Rewrite it to be strictly under that limit while keeping the same constraints (accuracy, intent, HTML/plain rules).',
    'Output only the text.',
    '',
    'Previous draft:',
    text,
  ].join('\n');

  const second = await openAIChatComplete(ctx, [
    { role: 'system', content: system },
    { role: 'user', content: user },
    { role: 'assistant', content: text },
    { role: 'user', content: retryUser },
  ]);

  if (second.length <= maxLength) return second;
  return hardTruncateAtWord(second, maxLength);
}

/**
 * @param {{ apiKey: string; baseUrl: string; model: string }} ctx
 * @param {SummarizeContext} context
 * @param {string} original
 * @param {number} maxLength
 */
async function summarizeOnceGemini(ctx, context, original, maxLength) {
  const user = buildUserPrompt(context, original, maxLength);
  const system = buildSystemPrompt(maxLength);

  const first = await geminiGenerateContent(ctx, {
    systemText: system,
    contents: [{ role: 'user', parts: [{ text: user }] }],
  });

  if (first.length <= maxLength) return first;

  const retryUser = [
    `Your previous answer was ${first.length} characters, which exceeds the limit of ${maxLength}.`,
    'Rewrite it to be strictly under that limit while keeping the same constraints (accuracy, intent, HTML/plain rules).',
    'Output only the text.',
    '',
    'Previous draft:',
    first,
  ].join('\n');

  const second = await geminiGenerateContent(ctx, {
    systemText: system,
    contents: [
      { role: 'user', parts: [{ text: user }] },
      { role: 'model', parts: [{ text: first }] },
      { role: 'user', parts: [{ text: retryUser }] },
    ],
  });

  if (second.length <= maxLength) return second;
  return hardTruncateAtWord(second, maxLength);
}

export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
export const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * @typedef {object} SummarizeLlmOpts
 * @property {'openai' | 'gemini'} provider
 * @property {string} apiKey
 * @property {string} [baseUrl]
 * @property {string} [model]
 * @property {number} [maxLength]
 */

/**
 * Optional context so the model knows what kind of text it is editing.
 * @typedef {object} SummarizeContext
 * @property {string} [kind] E.g. "playlist summary", "artist bio", "exhibition description"
 * @property {string} [subject] Short freeform subject line (work title, person name, etc.)
 * @property {Record<string, string>} [labels] Extra key/value lines (Title, Slug, Series, …)
 */

/**
 * Shorten `text` to at most `maxLength` (default 2000) using the configured LLM,
 * or mechanically if no provider/key.
 *
 * @param {SummarizeLlmOpts} opts
 * @param {SummarizeContext} [context]
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function summarizeLongText(opts, context = {}, text) {
  const maxLength = opts.maxLength ?? DEFAULT_MAX_TEXT_LENGTH;
  if (text.length <= maxLength) return text;
  if (!opts?.apiKey || !opts?.provider) {
    return mechanicalTruncate(text, maxLength);
  }

  const provider = opts.provider;
  const baseUrl =
    opts.baseUrl?.replace(/\/$/, '') ||
    (provider === 'gemini' ? DEFAULT_GEMINI_BASE : DEFAULT_OPENAI_BASE);
  const model = opts.model || (provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);

  const ctx = { apiKey: opts.apiKey, baseUrl, model };

  if (provider === 'openai') {
    return summarizeOnceOpenAI(ctx, context, text, maxLength);
  }
  if (provider === 'gemini') {
    return summarizeOnceGemini(ctx, context, text, maxLength);
  }
  throw new Error(`Unknown summary provider: ${provider}`);
}

/**
 * Playlist-oriented helper (same as summarizeLongText with playlist context).
 * @param {{ title: string; slug: string }} meta
 */
export async function summarizeSummaryText(opts, meta, original) {
  return summarizeLongText(
    opts,
    {
      kind: 'playlist summary',
      labels: { Title: meta.title, Slug: meta.slug },
    },
    original
  );
}
