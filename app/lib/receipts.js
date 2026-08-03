/**
 * Action shaping and receipts, shared by both executors.
 *
 * Handoff's outbound actions are split across two systems: Guild performs the
 * ones addressed to a person (email, Jira), RocketRide performs the rest
 * (calendar, doc, access revocation). Both need to shape arguments for their
 * integration and hand back a receipt in the same shape, so the activity feed
 * renders identically no matter which one did the work — and so a failure in
 * either degrades to a simulated receipt rather than a hole in the demo.
 */

/** Shape the action for a specific integration.
 *  VENUE: adjust argument names to match each integration's real schema. */
export function toolArgs(a) {
  switch (a.kind) {
    case 'email': return { to: a.to, subject: a.subject, body: a.body };
    case 'slack': return { channel: a.to, text: `*${a.subject}*
${a.body}`, unfurl_links: false };
    case 'jira': return { project: a.project || 'DW', summary: a.subject, description: a.body, assignee: a.to, labels: ['handoff', 'knowledge-transfer'] };
    case 'calendar': return { attendees: a.attendees, summary: a.subject, description: a.body, start: a.when, duration_minutes: a.minutes || 45 };
    case 'doc': return { title: a.subject, body: a.body };
    case 'revoke': return { user: a.to, effective: a.when, systems: a.systems };
    default: return a;
  }
}

export function normalizeReceipt(action, res) {
  return {
    id: res?.id || res?.key || res?.message_id || res?.issue_key || 'unknown',
    url: res?.url || res?.html_link || res?.browse_url || res?.self || null,
    summary: action.subject,
  };
}

/** Replay receipts. IDs that look like the real thing, so the UI layout is
 *  identical in both modes — no surprise text overflow on stage. */
let sim = 4400;
export function simulateReceipt(action) {
  const n = ++sim;
  switch (action.kind) {
    case 'email': return { id: `<handoff.${n}@example-spotify.com>`, url: null, summary: `Email → ${action.to}` };
    case 'slack': return { id: `p${Date.now()}.${n}`, url: null, summary: `Slack DM → ${action.to}` };
    case 'jira': return { id: `DW-${n}`, url: `https://jira.example.com/browse/DW-${n}`, summary: action.subject };
    case 'calendar': return { id: `evt_${n}`, url: `https://calendar.example.com/event/evt_${n}`, summary: `${action.subject} — ${action.whenLabel || ''}`.trim() };
    case 'doc': return { id: `doc_${n}`, url: `https://docs.example.com/d/doc_${n}`, summary: action.subject };
    case 'revoke': return { id: `rev_${n}`, url: null, summary: `Access revocation queued for ${action.whenLabel || action.when}` };
    default: return { id: `act_${n}`, url: null, summary: action.subject };
  }
}
