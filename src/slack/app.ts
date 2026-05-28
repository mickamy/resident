import { App } from "@slack/bolt";
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
    await handleMention({
      event,
      say: async (msg) => {
        await say(msg);
      },
      botUserId,
      run: runOnce,
    });
  });

  return { app, botUserId };
}

export type HandleMentionDeps = {
  event: AppMentionEvent;
  say: (msg: { thread_ts: string; text: string }) => Promise<void>;
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

  if (!text) {
    await say({ thread_ts, text: "(empty prompt)" });
    return;
  }

  try {
    const result = await run(text);
    await say({ thread_ts, text: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await say({ thread_ts, text: `error: ${message}` });
  }
}

export function stripBotMention(text: string, botUserId: string): string {
  const re = new RegExp(`<@${botUserId}>\\s*`, "g");
  return text.replace(re, "");
}
