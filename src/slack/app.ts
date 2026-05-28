import { App } from "@slack/bolt";
import type { SayFn } from "@slack/bolt/dist/types/utilities";
import type { AppMentionEvent } from "@slack/types";
import { runOnce } from "../agent/runner";

export type SlackAppOptions = {
  botToken: string;
  appToken: string;
};

export type CreateAppResult = {
  app: App;
  botUserId: string;
};

export async function createApp({ botToken, appToken }: SlackAppOptions): Promise<CreateAppResult> {
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

  app.event("app_mention", async ({ event, say }) => {
    // Do not await: Slack's 3 second ack timeout would fire long before runOnce returns.
    // Bolt acks the event as soon as this listener resolves.
    handleMention({
      event,
      say,
      botUserId,
      run: runOnce,
    }).catch((error) => {
      console.error("resident: unhandled error in handleMention:", error);
    });
  });

  return { app, botUserId };
}

export type HandleMentionDeps = {
  event: AppMentionEvent;
  say: SayFn;
  botUserId: string;
  run: (prompt: string) => Promise<string>;
};

export async function handleMention({
  event,
  say,
  botUserId,
  run,
}: HandleMentionDeps): Promise<void> {
  const text = stripBotMention(event.text, botUserId).trim();
  const thread_ts = event.thread_ts ?? event.ts;

  let replyText: string;
  if (!text) {
    replyText = "(empty prompt)";
  } else {
    try {
      replyText = await run(text);
    } catch (error) {
      replyText = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    await say({ thread_ts, text: replyText });
  } catch (sayError) {
    console.error("resident: failed to post to Slack:", sayError);
  }
}

export function stripBotMention(text: string, botUserId: string): string {
  const re = new RegExp(`<@${botUserId}>\\s*`, "g");
  return text.replace(re, "");
}
