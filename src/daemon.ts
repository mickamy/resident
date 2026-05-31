import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { RunOptions } from "./agent/runner";
import { loadConfig } from "./config/load";
import type { ResidentConfig } from "./config/schema";
import { createApp } from "./slack/app";

// Log and exit on any unhandled top-level failure so the process supervisor (systemd,
// Docker `restart: always`, …) sees a non-zero exit and restarts cleanly instead of the
// process limping on with an unrecoverable error.
process.once("uncaughtException", (error) => {
  // Pass through to console.error so Error stack traces and plain objects both keep
  // their full structure instead of being collapsed to "[object Object]".
  console.error("resident: uncaughtException:", error);
  process.exit(1);
});
process.once("unhandledRejection", (reason) => {
  console.error("resident: unhandledRejection:", reason);
  process.exit(1);
});

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken || !appToken) {
  console.error("error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set");
  process.exit(1);
}

const customConfigPath = process.env.RESIDENT_CONFIG;
const CONFIG_PATH = customConfigPath ?? join(homedir() || ".", ".resident", "config.toml");

// Explicit RESIDENT_CONFIG must load (no silent fallback); the default path is optional.
let cfg: ResidentConfig | null = null;
if (customConfigPath || existsSync(CONFIG_PATH)) {
  try {
    cfg = await loadConfig(CONFIG_PATH);
    console.log(`resident: loaded config from ${CONFIG_PATH}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const rawTimeout = process.env.RESIDENT_SHUTDOWN_DRAIN_TIMEOUT_MS?.trim();
const envTimeout = rawTimeout ? Number(rawTimeout) : 60_000;
if (!Number.isInteger(envTimeout) || envTimeout < 0) {
  console.error(
    `error: invalid RESIDENT_SHUTDOWN_DRAIN_TIMEOUT_MS: "${rawTimeout}" (expected non-negative integer)`,
  );
  process.exit(1);
}
const SHUTDOWN_DRAIN_TIMEOUT_MS = cfg?.shutdown.drain_timeout_ms ?? envTimeout;

const shutdownAbortController = new AbortController();

const rawMaxConcurrent = process.env.RESIDENT_MAX_CONCURRENT_MENTIONS?.trim();
const envMaxConcurrent = rawMaxConcurrent ? Number(rawMaxConcurrent) : 10;
if (!Number.isInteger(envMaxConcurrent) || envMaxConcurrent < 1) {
  console.error(
    `error: invalid RESIDENT_MAX_CONCURRENT_MENTIONS: "${rawMaxConcurrent}" (expected positive integer)`,
  );
  process.exit(1);
}
const maxConcurrentMentions = cfg?.mention.max_concurrent ?? envMaxConcurrent;

const envRawAllowed = process.env.RESIDENT_ALLOWED_USERS?.trim();
const envAllowedUsers = envRawAllowed
  ? new Set(
      envRawAllowed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;
const cfgAllowedUsers = cfg?.mention.allowed_users;
const allowedUsers =
  cfgAllowedUsers === undefined
    ? envAllowedUsers
    : cfgAllowedUsers === null
      ? null
      : new Set(cfgAllowedUsers);

if (allowedUsers === null) {
  console.warn(
    "resident: allowed_users is unset — every channel member can invoke the agent. Set mention.allowed_users in config or RESIDENT_ALLOWED_USERS to restrict.",
  );
}

const envRawWorkspace = process.env.RESIDENT_WORKSPACE?.trim();
let envWorkspacePath: string | undefined;
if (envRawWorkspace) {
  envWorkspacePath = resolve(envRawWorkspace);
  if (!statSync(envWorkspacePath, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`error: RESIDENT_WORKSPACE "${envRawWorkspace}" is not an existing directory`);
    process.exit(1);
  }
}
const workspacePath = cfg?.runner.workspace?.path ?? envWorkspacePath;

const mcpServers: Record<
  string,
  { command: string; args: string[]; env?: Record<string, string> }
> = {
  ...(cfg?.mcp_servers ?? {}),
};
if (workspacePath) {
  mcpServers.filesystem = {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2026.1.14", workspacePath],
  };
}
const hasMcp = Object.keys(mcpServers).length > 0;

const runOptions: RunOptions = {
  systemPrompt:
    cfg?.runner.system_prompt ?? (process.env.RESIDENT_SYSTEM_PROMPT?.trim() || undefined),
  model: cfg?.runner.model ?? (process.env.RESIDENT_MODEL?.trim() || undefined),
  mcpServers: hasMcp ? mcpServers : undefined,
  permissionMode: hasMcp ? "bypassPermissions" : undefined,
  allowDangerouslySkipPermissions: hasMcp ? true : undefined,
  abortController: shutdownAbortController,
};

try {
  const { app, botUserId, drainActive } = await createApp({
    botToken,
    appToken,
    allowedUsers,
    runOptions,
    maxConcurrentMentions,
    alertTriggers: cfg?.triggers.alerts ?? [],
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.log(`resident: ${signal} received while already shutting down, ignoring`);
      return;
    }
    shuttingDown = true;
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
      process.exit(drainResult === "timeout" ? 1 : 0);
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

  await app.start();
  console.log(`resident: connected to Slack via Socket Mode (bot user_id = ${botUserId})`);
} catch (error) {
  console.error(
    "error: failed to start Slack daemon:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
