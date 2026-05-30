import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_PATH = join(homedir(), ".resident", "config.toml");

const SKELETON = `# resident configuration
# https://github.com/mickamy/resident

[mention]
# null => allow every channel member; otherwise an array of Slack user IDs.
# allowed_users = ["U_ALICE", "U_BOB"]
max_concurrent = 10
# prompt = ""  # optional system prompt override for mention mode

[shutdown]
drain_timeout_ms = 60000

[runner]
# model = "claude-opus-4-7"
# system_prompt = ""

# [runner.workspace]
# path = "/var/lib/resident/repos"

# Auto-reply to bot alert posts in specific channels.
# [[triggers.alerts]]
# channels = ["C01OPS"]
# app_ids  = ["A0DATADOG"]
# prompt   = "prompts/alert.md"

# Additional MCP servers wired into the agent's tool set.
# [[mcp_servers]]
# name = "datadog"
# command = "npx"
# args = ["-y", "@datadog/mcp-server"]
# env = { DD_API_KEY = "\${DD_API_KEY}" }
`;

const path = process.argv[2] ?? DEFAULT_PATH;

if (existsSync(path)) {
  console.error(`error: ${path} already exists; remove it first to regenerate`);
  process.exit(1);
}

try {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SKELETON, { mode: 0o600 });
  console.log(`resident: wrote skeleton config to ${path}`);
} catch (error) {
  console.error(
    `error: failed to write config to ${path}:`,
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
