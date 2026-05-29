import { App } from "@slack/bolt";
import type { SayFn } from "@slack/bolt/dist/types/utilities";
import type { AppMentionEvent } from "@slack/types";
import { runOnce } from "../agent/runner";

export type SlackAppOptions = {
  botToken: string;
  appToken: string;
  allowedUsers: ReadonlySet<string> | null;
};

export type CreateAppResult = {
  app: App;
  botUserId: string;
  drainActive: (timeoutMs: number) => Promise<void>;
};

export async function createApp({
  botToken,
  appToken,
  allowedUsers,
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

  app.event("app_mention", async ({ event, say }) => {
    // Skip mentions originating from another bot to avoid response loops.
    if (event.bot_id) {
      return;
    }
    // Do not await: Slack's 3 second ack timeout would fire long before runOnce returns.
    // Bolt acks the event as soon as this listener resolves.
    const p = handleMention({
      event,
      say,
      botUserId,
      allowedUsers,
      run: runOnce,
    }).catch((error) => {
      console.error("resident: unhandled error in handleMention:", error);
    });
    activePromises.add(p);
    p.finally(() => activePromises.delete(p));
  });

  const drainActive = async (timeoutMs: number): Promise<void> => {
    if (activePromises.size === 0) return;
    const drain = Promise.allSettled([...activePromises]);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs),
    );
    const result = await Promise.race([drain.then(() => "done" as const), timeout]);
    if (result === "timeout") {
      console.error(`resident: drain timed out with ${activePromises.size} in-flight handler(s)`);
    }
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
    return;
  }
  const text = stripBotMention(event.text ?? "", botUserId).trim();
  const thread_ts = event.thread_ts ?? event.ts;

  let replyText: string;
  if (!text) {
    replyText = "(empty prompt)";
  } else {
    try {
      // Slack's chat.postMessage rejects empty/whitespace-only text with no_text.
      replyText = (await run(text)).trim() || "(no response)";
    } catch (error) {
      console.error("resident: runOnce failed:", error);
      replyText = "error: see logs";
    }
  }

  try {
    await say({ thread_ts, text: replyText });
  } catch (sayError) {
    console.error("resident: failed to post to Slack:", sayError);
  }
}

export function stripBotMention(text: string, botUserId: string): string {
  // Match both <@U123> and <@U123|display_name> forms.
  const re = new RegExp(`<@${botUserId}(?:\\|[^>]*)?>\\s*`, "g");
  return text.replace(re, "");
}
