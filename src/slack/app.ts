import { App } from "@slack/bolt";
import type { SayFn } from "@slack/bolt/dist/types/utilities";
import type { AppMentionEvent } from "@slack/types";
import { type RunOptions, runOnce } from "../agent/runner";
import type { AlertTrigger } from "../config/schema";

const DEFAULT_ALERT_SYSTEM_PROMPT =
  "You are an SRE assistant triaging an inbound alert. Reply in 3 short lines: " +
  "(1) most likely root-cause hypothesis, (2) blast radius / affected services, " +
  "(3) one concrete next step. Use the available tools if extra context is needed.";

export type SlackAppOptions = {
  botToken: string;
  appToken: string;
  allowedUsers: ReadonlySet<string> | null;
  runOptions?: RunOptions;
  maxConcurrentMentions?: number;
  alertTriggers?: readonly AlertTrigger[];
};

export type CreateAppResult = {
  app: App;
  botUserId: string;
  drainActive: (timeoutMs: number) => Promise<"done" | "timeout">;
};

export async function createApp({
  botToken,
  appToken,
  allowedUsers,
  runOptions,
  maxConcurrentMentions = Number.POSITIVE_INFINITY,
  alertTriggers,
}: SlackAppOptions): Promise<CreateAppResult> {
  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  const authResult = await app.client.auth.test();
  if (!authResult.user_id) {
    throw new Error("Slack auth.test did not return a user_id");
  }
  const botUserId = authResult.user_id;

  const activePromises = new Set<Promise<unknown>>();

  // Slack Socket Mode is at-least-once: dedup by envelope event_id to avoid duplicate replies on redelivery.
  const seenEventIds = new Map<string, number>();
  const DEDUP_TTL_MS = 10 * 60 * 1000;

  app.event("app_mention", async ({ event, say, body }) => {
    // Skip self-mentions to avoid response loops.
    if (event.user === botUserId) {
      return;
    }
    // Skip subtype-bearing events (message_changed, message_deleted) so edits/deletes don't re-trigger.
    if (event.subtype) {
      return;
    }
    if (isDuplicateEvent(body.event_id, seenEventIds, DEDUP_TTL_MS)) return;
    if (activePromises.size >= maxConcurrentMentions) {
      console.warn(
        `resident: dropping mention from ${event.user ?? "unknown"} (active: ${activePromises.size}, max: ${maxConcurrentMentions})`,
      );
      void say({
        thread_ts: event.thread_ts ?? event.ts,
        text: "busy — please try again shortly",
      }).catch((err) => {
        console.error("resident: failed to post busy notice:", err);
      });
      return;
    }
    // Do not await: Slack's 3 second ack timeout would fire long before runOnce returns.
    // Bolt acks the event as soon as this listener resolves.
    const p = handleMention({
      event,
      say,
      botUserId,
      allowedUsers,
      run: (prompt) => runOnce(prompt, runOptions),
    }).catch((error) => {
      console.error("resident: unhandled error in handleMention:", error);
    });
    activePromises.add(p);
    p.finally(() => activePromises.delete(p));
  });

  if (alertTriggers && alertTriggers.length > 0) {
    app.event("message", async ({ event, say, body }) => {
      const ev = event as unknown as Record<string, unknown>;
      // Skip the bot's own posts to avoid response loops.
      if (ev.user === botUserId) return;
      // Only react to bot posts (subtype 'bot_message' or any event carrying bot_id).
      const isBotPost = ev.subtype === "bot_message" || typeof ev.bot_id === "string";
      if (!isBotPost) return;
      // Skip thread replies; alert sources often post follow-up updates in the same thread.
      if (typeof ev.thread_ts === "string" && ev.thread_ts !== ev.ts) return;
      // Reject every subtype except 'bot_message' so edits / deletes (message_changed,
      // message_deleted, …) don't re-trigger a triage run on the same alert.
      if (typeof ev.subtype === "string" && ev.subtype !== "bot_message") return;

      // Extract the alert body up-front so we skip everything else (dedup, trigger lookup,
      // concurrency check) when the event has no usable text — common for non-alert bot posts.
      const text = getAlertText(ev);
      if (!text) return;

      if (isDuplicateEvent(body.event_id, seenEventIds, DEDUP_TTL_MS)) return;

      const channel = typeof ev.channel === "string" ? ev.channel : undefined;
      const appId = typeof ev.app_id === "string" ? ev.app_id : undefined;
      const trigger = findAlertTrigger({ channel, app_id: appId }, alertTriggers);
      if (!trigger) return;

      if (activePromises.size >= maxConcurrentMentions) {
        console.warn(
          `resident: dropping alert from ${channel ?? "unknown"} (active: ${activePromises.size}, max: ${maxConcurrentMentions})`,
        );
        return;
      }

      const p = handleAlert({
        event: {
          text,
          ts: typeof ev.ts === "string" ? ev.ts : "",
          thread_ts: typeof ev.thread_ts === "string" ? ev.thread_ts : undefined,
          channel: channel ?? "",
        },
        say,
        trigger,
        defaultSystemPrompt: DEFAULT_ALERT_SYSTEM_PROMPT,
        run: (prompt, opts) =>
          runOnce(prompt, {
            ...runOptions,
            systemPrompt: opts?.systemPrompt ?? runOptions?.systemPrompt,
          }),
      }).catch((error) => {
        console.error("resident: unhandled error in handleAlert:", error);
      });
      activePromises.add(p);
      p.finally(() => activePromises.delete(p));
    });
  }

  const drainActive = async (timeoutMs: number): Promise<"done" | "timeout"> => {
    if (activePromises.size === 0) return "done";
    const drain = Promise.allSettled([...activePromises]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const result = await Promise.race([drain.then(() => "done" as const), timeout]);
    if (timer) clearTimeout(timer);
    if (result === "timeout") {
      console.error(`resident: drain timed out with ${activePromises.size} in-flight handler(s)`);
    }
    return result;
  };

  return { app, botUserId, drainActive };
}

export type HandleMentionDeps = {
  event: AppMentionEvent;
  say: SayFn;
  botUserId: string;
  allowedUsers?: ReadonlySet<string> | null;
  run: (prompt: string) => Promise<string>;
};

export async function handleMention({
  event,
  say,
  botUserId,
  allowedUsers,
  run,
}: HandleMentionDeps): Promise<void> {
  if (allowedUsers && (!event.user || !allowedUsers.has(event.user))) {
    console.warn(`resident: ignoring mention from unauthorized user: ${event.user ?? "unknown"}`);
    return;
  }
  const text = stripBotMention(event.text ?? "", botUserId).trim();
  if (!text) {
    return;
  }
  const thread_ts = event.thread_ts ?? event.ts;

  let replyText: string;
  try {
    // Slack's chat.postMessage rejects empty/whitespace-only text with no_text.
    replyText = (await run(text)).trim() || "(no response)";
  } catch (error) {
    console.error("resident: runOnce failed:", error);
    replyText = "error: see logs";
  }

  try {
    await say({ thread_ts, text: replyText });
  } catch (sayError) {
    console.error("resident: failed to post to Slack:", sayError);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDuplicateEvent(
  eventId: string | undefined,
  seenEventIds: Map<string, number>,
  ttlMs: number,
): boolean {
  if (!eventId) return false;
  const now = Date.now();
  // Map preserves insertion order, so the oldest entries are at the front.
  // Stop as soon as we hit a non-expired entry; everything after it is fresher.
  for (const [id, ts] of seenEventIds) {
    if (now - ts > ttlMs) {
      seenEventIds.delete(id);
    } else {
      break;
    }
  }
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.set(eventId, now);
  return false;
}

export function stripBotMention(text: string, botUserId: string): string {
  // Match both <@U123> and <@U123|display_name> forms.
  const re = new RegExp(`<@${escapeRegExp(botUserId)}(?:\\|[^>]*)?>\\s*`, "g");
  return text.replace(re, "");
}

export type AlertEvent = {
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
};

export type HandleAlertDeps = {
  event: AlertEvent;
  say: SayFn;
  trigger: AlertTrigger;
  defaultSystemPrompt: string;
  run: (prompt: string, options?: { systemPrompt?: string }) => Promise<string>;
};

/**
 * Pull the alert body out of a Slack `message` event. Datadog / AWS Chatbot / Grafana et al.
 * often put the real content into `attachments[*].{pretext,title,text,fallback}` while the
 * top-level `text` is empty or a fallback string, so concatenate whatever string fields we
 * find rather than relying on `text` alone.
 */
export function getAlertText(ev: Record<string, unknown>): string {
  // Use a Set so identical strings (e.g., text == fallback in many integrations) don't get repeated.
  const parts = new Set<string>();
  const pushIfString = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.add(v.trim());
  };
  pushIfString(ev.text);
  if (Array.isArray(ev.attachments)) {
    for (const att of ev.attachments) {
      if (att && typeof att === "object") {
        const a = att as Record<string, unknown>;
        pushIfString(a.pretext);
        pushIfString(a.title);
        pushIfString(a.text);
        pushIfString(a.fallback);
        if (Array.isArray(a.fields)) {
          for (const f of a.fields) {
            if (f && typeof f === "object") {
              const field = f as Record<string, unknown>;
              pushIfString(field.title);
              pushIfString(field.value);
            }
          }
        }
      }
    }
  }
  return Array.from(parts).join("\n").trim();
}

export function findAlertTrigger(
  event: { channel?: string; app_id?: string },
  triggers: readonly AlertTrigger[],
): AlertTrigger | undefined {
  if (!event.channel || !event.app_id) return undefined;
  const { channel, app_id } = event;
  return triggers.find((t) => t.channels.includes(channel) && t.app_ids.includes(app_id));
}

export async function handleAlert({
  event,
  say,
  trigger,
  defaultSystemPrompt,
  run,
}: HandleAlertDeps): Promise<void> {
  const text = event.text.trim();
  if (!text) return;

  const thread_ts = event.thread_ts ?? event.ts;
  const systemPrompt = trigger.prompt || defaultSystemPrompt;

  let replyText: string;
  try {
    replyText = (await run(text, { systemPrompt })).trim() || "(no response)";
  } catch (error) {
    // Alerts are unattended; log and stay quiet rather than spamming the channel during flaps.
    console.error("resident: runOnce failed (alert):", error);
    return;
  }

  try {
    await say({ thread_ts, text: replyText });
  } catch (sayError) {
    console.error("resident: failed to post alert reply to Slack:", sayError);
  }
}
