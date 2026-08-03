/**
 * Optional garnish — Linkup prices the loss.
 *
 * Knowing what dies with her is half the argument. The other half is what it
 * costs: if this skill profile takes fourteen weeks to rehire in this market,
 * then fourteen weeks is how long the gap stays open, and rescue priority
 * should follow the money rather than the org chart.
 *
 * Not one of the four mandated technologies — first thing to cut if the clock
 * runs out. Fails soft to a cached estimate.
 */

import config from '../config.js';

const CACHED = {
  weeksToRehire: 14,
  medianComp: '$268k',
  openRoles: 412,
  headline: 'Staff-level personalization / ranking engineers, SF Bay Area',
  source: 'cached estimate',
};

export class Linkup {
  constructor(opts = config.linkup) { this.opts = opts; }

  async priceLoss(role, market = 'San Francisco Bay Area') {
    if (!this.opts.enabled) return null;
    if (this.opts.mode !== 'live' || !this.opts.apiKey) return { ...CACHED, role, market };

    try {
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          q: `time to hire and median compensation for ${role} in ${market} 2026`,
          depth: 'standard',
          outputType: 'sourcedAnswer',
        }),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      return {
        ...CACHED,
        role,
        market,
        headline: data.answer?.slice(0, 220) || CACHED.headline,
        weeksToRehire: extractWeeks(data.answer) ?? CACHED.weeksToRehire,
        sources: (data.sources || []).slice(0, 3).map((s) => ({ name: s.name, url: s.url })),
        source: 'linkup',
      };
    } catch (err) {
      console.warn(`[linkup] live search failed (${err.message}) — using cached estimate`);
      return { ...CACHED, role, market };
    }
  }
}

function extractWeeks(text = '') {
  const m = /(\d{1,2})\s*weeks?/i.exec(text);
  return m ? Number(m[1]) : null;
}
