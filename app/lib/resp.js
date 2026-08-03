/**
 * Minimal Redis (RESP2) client — ~120 lines, zero dependencies.
 *
 * FalkorDB speaks the Redis wire protocol, so this is all that stands between
 * us and real GRAPH.QUERY execution. Hand-rolling it means `npm install` can
 * never fail at the venue, which is worth more today than a nicer API.
 */

import net from 'node:net';

export class RespClient {
  constructor({ host, port, username, password }) {
    this.opts = { host, port, username, password };
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.queue = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.opts.host, port: this.opts.port });
      socket.setNoDelay(true);
      const onError = (err) => { socket.destroy(); reject(err); };
      socket.once('error', onError);
      socket.once('connect', async () => {
        socket.off('error', onError);
        socket.on('error', (err) => this.#failAll(err));
        socket.on('close', () => this.#failAll(new Error('FalkorDB connection closed')));
        socket.on('data', (chunk) => this.#onData(chunk));
        this.socket = socket;
        try {
          if (this.opts.password) {
            await this.command(this.opts.username ? ['AUTH', this.opts.username, this.opts.password] : ['AUTH', this.opts.password]);
          }
          await this.command(['PING']);
          resolve(this);
        } catch (err) { reject(err); }
      });
    });
  }

  command(args) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('not connected'));
      this.queue.push({ resolve, reject });
      this.socket.write(encode(args));
    });
  }

  quit() {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

  #failAll(err) {
    const q = this.queue; this.queue = [];
    for (const p of q) p.reject(err);
  }

  #onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const result = decode(this.buf, 0);
      if (!result) return;                       // incomplete frame — wait for more
      this.buf = this.buf.subarray(result.next);
      const pending = this.queue.shift();
      if (!pending) continue;
      if (result.value instanceof Error) pending.reject(result.value);
      else pending.resolve(result.value);
    }
  }
}

function encode(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const s = Buffer.from(String(a));
    parts.push(Buffer.from(`$${s.length}\r\n`), s, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

/** Returns {value, next} or null when the buffer holds an incomplete frame. */
function decode(buf, i) {
  if (i >= buf.length) return null;
  const type = buf[i];
  const eol = buf.indexOf('\r\n', i);
  if (eol === -1) return null;
  const line = buf.toString('utf8', i + 1, eol);
  const next = eol + 2;

  switch (type) {
    case 0x2b: return { value: line, next };                       // +simple
    case 0x2d: return { value: new Error(line), next };            // -error
    case 0x3a: return { value: Number(line), next };               // :integer
    case 0x24: {                                                   // $bulk
      const len = Number(line);
      if (len === -1) return { value: null, next };
      const end = next + len;
      if (buf.length < end + 2) return null;
      return { value: buf.toString('utf8', next, end), next: end + 2 };
    }
    case 0x2a: {                                                   // *array
      const len = Number(line);
      if (len === -1) return { value: null, next };
      const out = [];
      let cursor = next;
      for (let k = 0; k < len; k++) {
        const item = decode(buf, cursor);
        if (!item) return null;
        out.push(item.value);
        cursor = item.next;
      }
      return { value: out, next: cursor };
    }
    default:
      throw new Error(`unsupported RESP type: ${String.fromCharCode(type)}`);
  }
}

/** Cypher string literal escaping. Everything we interpolate is seeded data we
 *  generated ourselves, but a stray apostrophe in a commit message would still
 *  break the query, and "Sarah's fix" is exactly the kind of message she writes. */
export function esc(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'`;
}

/** Object → Cypher map literal, e.g. {id: 'f:1', criticality: 5} */
export function mapLit(obj) {
  const pairs = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(esc).join(', ')}]` : esc(v)}`);
  return `{${pairs.join(', ')}}`;
}
