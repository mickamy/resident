import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { RunOptions } from "./agent/runner";
import { createApp } from "./slack/app";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken || !appToken) {
  console.error("error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set");
  process.exit(1);
}

const rawTimeout = process.env.RESIDENT_SHUTDOWN_DRAIN_TIMEOUT_MS?.trim();
const SHUTDOWN_DRAIN_TIMEOUT_MS = rawTimeout ? Number(rawTimeout) : 60_000;
if (!Number.isFinite(SHUTDOWN_DRAIN_TIMEOUT_MS) || SHUTDOWN_DRAIN_TIMEOUT_MS < 0) {
  console.error(
    `error: invalid RESIDENT_SHUTDOWN_DRAIN_TIMEOUT_MS: "${rawTimeout}" (expected non-negative integer)`,
  );
  process.exit(1);
}

const shutdownAbortController = new AbortController();

const rawMaxConcurrent = process.env.RESIDENT_MAX_CONCURRENT_MENTIONS?.trim();
const maxConcurrentMentions = rawMaxConcurrent ? Number(rawMaxConcurrent) : 10;
if (!Number.isInteger(maxConcurrentMentions) || maxConcurrentMentions < 1) {
  console.error(
    `error: invalid RESIDENT_MAX_CONCURRENT_MENTIONS: "${rawMaxConcurrent}" (expected positive integer)`,
  );
  process.exit(1);
}

const rawAllowed = process.env.RESIDENT_ALLOWED_USERS?.trim();
const allowedUsers = rawAllowed
  ? new Set(
      rawAllowed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

if (allowedUsers === null) {
  console.warn(
    "resident: RESIDENT_ALLOWED_USERS not set — every channel member can invoke the agent. Set it to a CSV of Slack user IDs to restrict access.",
  );
}

const rawWorkspace = process.env.RESIDENT_WORKSPACE?.trim();
let workspacePath: string | undefined;
if (rawWorkspace) {
  workspacePath = resolve(rawWorkspace);
  if (!statSync(workspacePath, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`error: RESIDENT_WORKSPACE "${rawWorkspace}" is not an existing directory`);
    process.exit(1);
  }
}

const runOptions: RunOptions = {
  systemPrompt: process.env.RESIDENT_SYSTEM_PROMPT?.trim() || undefined,
  model: process.env.RESIDENT_MODEL?.trim() || undefined,
  mcpServers: workspacePath
    ? {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem@2026.1.14", workspacePath],
        },
      }
    : undefined,
  permissionMode: workspacePath ? "bypassPermissions" : undefined,
  allowDangerouslySkipPermissions: workspacePath ? true : undefined,
  abortController: shutdownAbortController,
};

try {
  const { app, botUserId, drainActive } = await createApp({
    botToken,
    appToken,
    allowedUsers,
    runOptions,
    maxConcurrentMentions,
  });
  await app.start();
  console.log(`resident: connected to Slack via Socket Mode (bot user_id = ${botUserId})`);

  const shutdown = async (signal: string) => {
    console.log(
      `resident: received ${signal}, draining in-flight handlers (up to ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms)...`,
    );
    try {
      await app.stop();
      const drainResult = await drainActive(SHUTDOWN_DRAIN_TIMEOUT_MS);
      if (drainResult === "timeout") {
        console.error("resident: aborting in-flight handlers");
        shutdownAbortController.abort();
        await new Promise((r) => setTimeout(r, 1_000));
      }
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
