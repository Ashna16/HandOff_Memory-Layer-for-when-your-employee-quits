"use agent";

/**
 * handoff-rescuer — the hands of the Handoff system.
 *
 * Handoff maps everything a departing engineer owns, works out what dies with
 * them, interviews them about the parts nobody wrote down, and then has to
 * actually *do* something about it. This agent is that last part: every action
 * addressed to a human runs through here, on Guild's connectors, with Guild
 * holding the credentials.
 *
 * One agent, five verbs, dispatched on `action`:
 *
 *   reassign  move an existing ticket to its new owner  ← the live moment
 *   jira      file a handover ticket
 *   slack     the question list, DM'd to the person leaving
 *   email     a briefing to each successor before their transfer session
 *   calendar  the transfer session itself
 *
 * `reassign` is the one that matters on stage: a real PUT against a real Jira
 * issue, so the board changes while the audience is looking at it.
 *
 * Deliberately not an LLM agent. Handoff has already decided what to do and
 * written the copy; asking a model to re-decide it here would add latency and
 * a second place for the demo to go wrong. This is a typed, deterministic
 * executor — which is also what makes it safe to hand real credentials to.
 */

import { type Task, agent, consoleTools, pick } from "@guildai/agents-sdk";
import { jiraTools } from "@guildai-services/guildai~jira";
import { slackTools } from "@guildai-services/guildai~slack";
import { GmailOauthTools } from "@guildai-services/guildlabs~gmail-oauth";
import { GoogleCalendarOauthTools } from "@guildai-services/guildlabs~google-calendar-oauth";
import { z } from "zod";

const inputSchema = z.object({
  action: z
    .enum(["slack", "email", "calendar", "jira", "reassign", "diagnose", "seed", "whoAssignable"])
    .describe("Which outbound action to perform"),

  to: z.string().optional().describe("Recipient: email address, Slack channel/handle, or Jira accountId"),
  subject: z.string().optional().describe("Subject line, Slack heading, event title, or issue summary"),
  body: z.string().optional().describe("Message body / issue description / event description"),

  // jira + reassign
  project: z.string().optional().describe("Jira project key, e.g. DW. Falls back to the first accessible project."),
  issueKey: z.string().optional().describe("Existing issue key to reassign, e.g. DW-1841"),
  assigneeAccountId: z.string().optional().describe("Jira accountId to assign to"),
  assigneeEmail: z.string().optional().describe("Assignee email — resolved to an accountId when accountId is absent"),
  labels: z.array(z.string()).optional(),

  // calendar
  startsAt: z.string().optional().describe("ISO 8601 start time"),
  minutes: z.number().optional().describe("Duration in minutes, default 45"),
  attendees: z.array(z.string()).optional(),

  jiraSite: z.string().optional().describe("Atlassian site host, e.g. acme.atlassian.net — used to build browse URLs"),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  id: z.string().describe("Provider id — issue key, message ts, event id"),
  url: z.string().optional(),
  summary: z.string().describe("One line describing what actually happened"),
});

type Output = z.infer<typeof outputSchema>;

/**
 * Scoped deliberately narrowly. The agent can create and edit issues and look
 * up who it is allowed to assign to — it cannot delete anything and cannot
 * touch project configuration. Guild enforces this at the gateway, so the
 * scope is a real boundary rather than a comment.
 */
const tools = {
  ...pick(jiraTools, [
    "jira_create_issue",
    "jira_edit_issue",
    "jira_get_all_projects",
    "jira_list_projects",
    "jira_find_assignable_users",
    "jira_get_issue",
    "jira_get_current_user",
  ]),
  ...pick(slackTools, ["slack_chat_post_message"]),
  ...pick(GmailOauthTools, ["gmail_oauth_users_messages_send"]),
  ...pick(GoogleCalendarOauthTools, ["google_calendar_oauth_events_insert"]),
  ...consoleTools,
};

type Tools = typeof tools;

/** Jira's ADF body format — plain paragraphs are all we need. */
function adf(text: string) {
  const paragraphs = String(text || "")
    .split("\n")
    .map((line) => ({
      type: "paragraph",
      content: line.trim() ? [{ type: "text", text: line }] : [],
    }));
  return { type: "doc", version: 1, content: paragraphs };
}

async function firstProjectKey(task: Task<Tools>): Promise<string> {
  let projects: any;
  try {
    projects = await task.tools.jira_list_projects({});
  } catch {
    projects = await task.tools.jira_get_all_projects({});
  }
  const list: Array<{ key?: string }> = Array.isArray(projects)
    ? projects
    : (projects?.values ?? []);
  for (const p of list) if (p?.key) return p.key;
  throw new Error("No accessible Jira project. Create one, or pass project=KEY.");
}

/** Turn an email address into a Jira accountId, which is what the API wants. */
async function resolveAssignee(task: Task<Tools>, input: Input): Promise<string | null> {
  if (input.assigneeAccountId) return input.assigneeAccountId;
  const query = input.assigneeEmail || input.to;
  if (!query) return null;

  const project = input.project || (await firstProjectKey(task));
  try {
    const users: any = await task.tools.jira_find_assignable_users({ query, project });
    const list: Array<any> = Array.isArray(users) ? users : (users?.values ?? []);
    if (list.length && list[0].accountId) {
      await task.console.log("Resolved " + query + " to " + list[0].accountId);
      return list[0].accountId;
    }
  } catch (err) {
    await task.console.log("Could not resolve assignee for " + query + ": " + String(err));
  }
  return null;
}

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  await task.console.log("handoff-rescuer: " + input.action);

  // Who can this project assign work to? Determines how the reassignment demo
  // is staged — a personal site usually has only its owner.
  if (input.action === "whoAssignable") {
    const project = input.project || "KAN";
    const users: any = await task.tools.jira_find_assignable_users({ project, max_results: 50 });
    const list: any[] = Array.isArray(users) ? users : (users?.values ?? []);
    return {
      ok: true,
      action: "whoAssignable",
      id: project,
      summary: list.length
        ? list.map((u) => (u.displayName || u.name) + " [" + u.accountId + "]").join(" · ")
        : "no assignable users",
    };
  }

  // File the seeded offboarding backlog into a real Jira project, so the
  // handoff demo has real tickets to reassign on stage. Returns the created
  // keys as a comma list.
  if (input.action === "seed") {
    const project = input.project || "KAN";
    const seeds = [
      "Ranking weights review before Q3 model swap",
      "Cold-start cohort regression on new markets",
      "Move refresh cron into the new scheduler",
      "Retry-queue bypass rule is undocumented",
      "Feature store freshness alerting gap",
      "Backfill --no-parallel Friday constraint",
    ];
    const created: string[] = [];
    for (const title of seeds) {
      const types = ["Task", "Story", "Bug"];
      for (const issuetype of types) {
        try {
          const res: any = await task.tools.jira_create_issue({
            body: {
              fields: {
                project: { key: project },
                summary: "[Handoff] " + title,
                description: adf("Owned solely by the departing engineer. Filed by Handoff for the offboarding demo."),
                issuetype: { name: issuetype },
                labels: ["handoff", "offboarding-demo"],
              } as any,
            },
          });
          if (res?.key) { created.push(res.key); break; }
        } catch { /* try next issue type */ }
      }
    }
    return {
      ok: created.length > 0,
      action: "seed",
      id: created.join(","),
      summary: created.length + " tickets filed in " + project + ": " + created.join(", "),
    };
  }

  if (input.action === "diagnose") {
    // Separates "wrong Jira site" from "site has no projects": get_current_user
    // works on any live site, list_projects only returns rows once a project
    // exists. Reports both, never throws.
    let who = "unreachable";
    let projects = "unreachable";
    try {
      const me: any = await task.tools.jira_get_current_user({});
      who = (me?.displayName || me?.emailAddress || me?.accountId || "unknown") + "";
    } catch (err) {
      who = "ERR " + String(err).slice(0, 120);
    }
    try {
      const p: any = await task.tools.jira_list_projects({});
      const list: any[] = Array.isArray(p) ? p : (p?.values ?? []);
      projects = list.length
        ? list.map((x) => x.key + " (" + x.name + ")").join(", ")
        : "none — site is reachable but has zero projects";
    } catch (err) {
      projects = "ERR " + String(err).slice(0, 120);
    }
    return {
      ok: true,
      action: "diagnose",
      id: "",
      summary: "user=" + who + " | projects=" + projects,
    };
  }

  if (input.action === "reassign") {
    if (!input.issueKey) throw new Error("reassign requires issueKey");
    const accountId = await resolveAssignee(task, input);
    if (!accountId) {
      throw new Error(
        "Could not resolve a Jira account for " +
          (input.assigneeEmail || input.to || "(nobody)") +
          ". Pass assigneeAccountId directly.",
      );
    }

    await task.tools.jira_edit_issue({
      issue_id_or_key: input.issueKey,
      body: { fields: { assignee: { accountId } } as any },
    });

    if (input.body) {
      // Leave the "why" on the ticket itself, so the new owner inherits the
      // reasoning and not just the row.
      try {
        await task.tools.jira_edit_issue({
          issue_id_or_key: input.issueKey,
          body: { fields: { description: adf(input.body) } as any },
        });
      } catch {
        /* description edits can be blocked by screen config — assignment is the point */
      }
    }

    return {
      ok: true,
      action: "reassign",
      id: input.issueKey,
      summary: input.issueKey + " reassigned to " + (input.assigneeEmail || accountId),
    };
  }

  if (input.action === "jira") {
    const project = input.project || (await firstProjectKey(task));
    const accountId = await resolveAssignee(task, input);

    // Team-managed projects often have Task but not Bug.
    const types = ["Task", "Story", "Bug"];
    let created: any = null;
    let lastErr: unknown = null;

    for (const issuetype of types) {
      const fields: any = {
        project: { key: project },
        summary: String(input.subject || "Handover").slice(0, 255),
        description: adf(input.body || ""),
        issuetype: { name: issuetype },
        labels: input.labels ?? ["handoff", "knowledge-transfer"],
      };
      if (accountId) fields.assignee = { accountId };
      try {
        created = await task.tools.jira_create_issue({ body: { fields: fields as any } });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!created) throw lastErr ?? new Error("Could not create a Jira issue");

    const key = String(created.key ?? created.id ?? "unknown");
    return {
      ok: true,
      action: "jira",
      id: key,
      url: input.jiraSite ? "https://" + input.jiraSite + "/browse/" + key : undefined,
      summary: ("Filed " + key + " — " + (input.subject || "")).trim(),
    };
  }

  // Slack the departing engineer / a channel the question list or a handoff
  // notice — e.g. "KAN-1's assignee just changed."
  if (input.action === "slack") {
    const res: any = await task.tools.slack_chat_post_message({
      channel: input.to || "#general",
      text: input.subject ? "*" + input.subject + "*\n" + (input.body || "") : input.body || "",
      mrkdwn: true,
    } as any);
    const okSlack = Boolean(res?.ok ?? true);
    return {
      ok: okSlack,
      action: "slack",
      id: (res?.ts || res?.channel || "") + "",
      summary: okSlack
        ? "Slack posted to " + (input.to || "#general")
        : "Slack error: " + (res?.error || JSON.stringify(res || {}).slice(0, 160)),
    };
  }

  // Email a successor their session briefing, carrying what the interview
  // already captured. Gmail's send takes a base64url RFC-2822 message.
  if (input.action === "email") {
    const mime =
      "To: " + (input.to || "") + "\r\n" +
      "Subject: " + (input.subject || "Handoff") + "\r\n" +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
      (input.body || "");
    // base64url without Node's Buffer (not in the agent's type sandbox).
    const b64 = (globalThis as any).btoa
      ? (globalThis as any).btoa(unescape(encodeURIComponent(mime)))
      : (globalThis as any).Buffer.from(mime).toString("base64");
    const raw = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res: any = await task.tools.gmail_oauth_users_messages_send({ user_id: "me", raw } as any);
    return {
      ok: Boolean(res?.id),
      action: "email",
      id: (res?.id || "") + "",
      summary: "Email sent to " + (input.to || "(nobody)"),
    };
  }

  // Book the knowledge-transfer session on the real calendar.
  if (input.action === "calendar") {
    const start = input.startsAt || new Date().toISOString();
    const end = new Date(new Date(start).getTime() + (input.minutes || 45) * 60000).toISOString();
    const res: any = await task.tools.google_calendar_oauth_events_insert({
      calendar_id: "primary",
      send_updates: "all",
      summary: input.subject || "Knowledge transfer",
      description: input.body || "",
      start: { dateTime: start },
      end: { dateTime: end },
      attendees: (input.attendees || []).map((e) => ({ email: e })),
    } as any);
    return {
      ok: Boolean(res?.id),
      action: "calendar",
      id: (res?.id || "") + "",
      url: res?.htmlLink || undefined,
      summary: "Calendar event created: " + (input.subject || ""),
    };
  }

  throw new Error("Unknown action: " + (input as Input).action);
}

export default agent({
  inputSchema,
  outputSchema,
  tools,
  run,
});
