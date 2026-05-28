import { App } from "@slack/bolt";
import { runOnce } from "../agent/runner";

export type SlackAppOptions = {
  botToken: string;
  appToken: string;
};

export function createApp({ botToken, appToken }: SlackAppOptions): App {
  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  app.event("app_mention", async ({ event, say }) => {
    const text = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
    const thread_ts = event.thread_ts ?? event.ts;

    if (!text) {
      await say({ thread_ts, text: "(empty prompt)" });
      return;
    }

    try {
      const result = await runOnce(text);
      await say({ thread_ts, text: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await say({ thread_ts, text: `error: ${message}` });
    }
  });

  return app;
}
