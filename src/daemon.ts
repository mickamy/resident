import { createApp } from "./slack/app";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken || !appToken) {
  console.error("error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set");
  process.exit(1);
}

const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

try {
  const { app, botUserId, drainActive } = await createApp({ botToken, appToken });
  await app.start();
  console.log(`resident: connected to Slack via Socket Mode (bot user_id = ${botUserId})`);

  const shutdown = async (signal: string) => {
    console.log(
      `resident: received ${signal}, draining in-flight handlers (up to ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms)...`,
    );
    try {
      await drainActive(SHUTDOWN_DRAIN_TIMEOUT_MS);
      await app.stop();
      process.exit(0);
    } catch (err) {
      console.error("resident: shutdown error:", err);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
} catch (error) {
  console.error(
    "error: failed to start Slack daemon:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
