/**
 * Optional garnish — the security gate at offboarding.
 *
 * Her solo-owned code is about to be inherited by someone who has never read
 * it. Scanning it before the transfer means the new owner inherits a known
 * quantity instead of a surprise, and it makes access revocation a security
 * event rather than an IT chore.
 *
 * Not one of the four mandated technologies. Fails soft to a recorded finding.
 */

import config from '../config.js';

const RECORDED = [
  { severity: 'high', title: 'Hardcoded salt used for stable ordering', file: 'services/ranking/tie_breaker.py', line: 34, note: 'Inherited unchanged — rotating it is a user-visible event, so it needs an owner who knows that before it needs a fix.' },
  { severity: 'medium', title: 'Unpinned dependency in backfill job', file: 'services/ranking/backfill.py', line: 8, note: 'No lockfile entry; a transitive bump lands straight in the weekly run.' },
];

export class Snyk {
  constructor(opts = config.snyk) { this.opts = opts; }

  async scanOwned(files) {
    if (!this.opts.enabled) return null;
    const paths = files.map((f) => f.path).filter(Boolean);

    if (this.opts.mode === 'live' && this.opts.apiKey) {
      try {
        const res = await fetch(`https://api.snyk.io/rest/orgs/${this.opts.org}/issues?version=2024-10-15`, {
          headers: { authorization: `token ${this.opts.apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const findings = (data.data || []).slice(0, 4).map((i) => ({
          severity: i.attributes?.effective_severity_level || 'medium',
          title: i.attributes?.title || 'Issue',
          file: i.attributes?.coordinates?.[0]?.representations?.[0]?.sourceLocation?.file || paths[0],
          line: i.attributes?.coordinates?.[0]?.representations?.[0]?.sourceLocation?.region?.start?.line || 1,
          note: '',
        }));
        return { scanned: paths.length, findings, source: 'snyk' };
      } catch (err) {
        console.warn(`[snyk] live scan failed (${err.message}) — using recorded finding`);
      }
    }
    return { scanned: paths.length, findings: RECORDED, source: 'recorded' };
  }
}
