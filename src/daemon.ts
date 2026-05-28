import { createApp } from "./slack/app";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken || !appToken) {
  console.error("error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set");
  process.exit(1);
}

try {
  const { app, botUserId } = await createApp({ botToken, appToken });
  await app.start();
  console.log(`resident: connected to Slack via Socket Mode (bot user_id = ${botUserId})`);
} catch (error) {
  console.error(
    "error: failed to start Slack daemon:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
