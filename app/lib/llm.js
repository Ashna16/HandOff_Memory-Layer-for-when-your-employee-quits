/**
 * The reasoning layer.
 *
 * One thin client over a chat-completions API, with three entry points:
 * `json` for structured decisions, `stream` for the memory chat, and `embed`
 * for semantic retrieval.
 *
 * Every caller must supply a fallback. An LLM is an upgrade to Handoff's
 * judgement, never a dependency of its liveness — if the key is missing, the
 * network is down, or the request times out, the product keeps working with
 * deterministic logic and the UI says which one answered.
 */

import config from '../config.js';

export class LLM {
  constructor(opts = config.llm) {
    this.opts = opts;
    this.calls = [];       // every call made this session, surfaced in /api/state
    this.embedCache = new Map();
  }

  get available() { return Boolean(this.opts.enabled && this.opts.apiKey); }

  /** Model identity for the UI, without ever exposing the key. */
  describe() {
    return {
      available: this.available,
      provider: this.opts.provider,
      model: this.opts.model,
      chatModel: this.opts.chatModel,
      calls: this.calls.length,
      lastError: this.lastError || null,
    };
  }

  /**
   * Structured output. `schema` is a JSON Schema; the model is constrained to
   * it, so the result needs no parsing defence beyond JSON.parse.
   * Returns null on any failure — callers fall back.
   */
  async json({ system, user, schema, name = 'result', model, maxTokens = 3000 }) {
    if (!this.available) return null;
    const started = Date.now();
    try {
      const res = await this.#post('/chat/completions', {
        model: model || this.opts.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      });
      const text = res.choices?.[0]?.message?.content;
      if (!text) throw new Error('empty completion');
      const parsed = JSON.parse(text);
      this.#record(name, started, res.usage);
      return parsed;
    } catch (err) {
      this.#fail(name, started, err);
      return null;
    }
  }

  /** Plain text, no structure. */
  async text({ system, user, model, maxTokens = 2000 }) {
    if (!this.available) return null;
    const started = Date.now();
    try {
      const res = await this.#post('/chat/completions', {
        model: model || this.opts.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_completion_tokens: maxTokens,
      });
      this.#record('text', started, res.usage);
      return res.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      this.#fail('text', started, err);
      return null;
    }
  }

  /**
   * Streaming chat. Calls `onDelta(chunk)` as tokens arrive and resolves with
   * the full text. The memory chat streams because a wall of text appearing at
   * once reads as canned, and because it gives the room something to watch.
   */
  async stream({ messages, model, maxTokens = 4000, onDelta }) {
    if (!this.available) return null;
    const started = Date.now();
    try {
      const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({
          model: model || this.opts.chatModel,
          messages,
          max_completion_tokens: maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);

      let full = '';
      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();                       // keep the partial line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) { full += delta; onDelta?.(delta); }
          } catch { /* keep-alive or partial frame */ }
        }
      }
      this.#record('stream', started, null);
      return full;
    } catch (err) {
      this.#fail('stream', started, err);
      return null;
    }
  }

  /** Batch embeddings, cached by exact text. */
  async embed(texts) {
    if (!this.available) return null;
    const missing = texts.filter((t) => !this.embedCache.has(t));
    if (missing.length) {
      const started = Date.now();
      try {
        // Chunked: a 40-file repo is fine in one request, a real one is not.
        for (let i = 0; i < missing.length; i += 256) {
          const batch = missing.slice(i, i + 256);
          const res = await this.#post('/embeddings', { model: this.opts.embedModel, input: batch });
          res.data.forEach((d, k) => this.embedCache.set(batch[k], d.embedding));
        }
        this.#record('embed', started, null);
      } catch (err) {
        this.#fail('embed', started, err);
        return null;
      }
    }
    return texts.map((t) => this.embedCache.get(t));
  }

  async #post(route, body) {
    const res = await fetch(`${this.opts.baseUrl}${route}`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    return res.json();
  }

  #headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` };
  }

  #record(kind, started, usage) {
    this.calls.push({ kind, ms: Date.now() - started, tokens: usage?.total_tokens ?? null, ok: true, at: started });
    this.lastError = null;
  }

  #fail(kind, started, err) {
    // Log, never throw. A failed call must degrade the answer, not the demo.
    console.warn(`[llm] ${kind} failed (${err.message}) — using deterministic fallback`);
    this.calls.push({ kind, ms: Date.now() - started, ok: false, error: err.message, at: started });
    this.lastError = err.message;
  }
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
