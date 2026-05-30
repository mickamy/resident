import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";

const home = homedir();
const DEFAULT_PATH = home ? join(home, ".resident", "config.toml") : null;

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

const USAGE = "usage: resident init [-c|--config <path>] [-f|--force]";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    force: { type: "boolean", short: "f" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const configPath = values.config ?? DEFAULT_PATH;
if (!configPath) {
  console.error("error: $HOME is not set; pass --config <path> to choose a target");
  process.exit(1);
}
const path = resolvePath(configPath);

try {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, SKELETON, { flag: values.force ? "w" : "wx", mode: 0o600 });
  console.log(`resident: wrote skeleton config to ${path}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") {
    console.error(`error: ${path} already exists; pass --force to overwrite or remove it first`);
    process.exit(1);
  }
  console.error(
    `error: failed to write config to ${path}:`,
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
