import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runOnce } from "./agent/runner";

const USAGE =
  "usage: resident [-s|--system <prompt>] [-m|--model <name>] [-w|--workspace <dir>] <prompt>";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    system: { type: "string", short: "s" },
    model: { type: "string", short: "m" },
    workspace: { type: "string", short: "w" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const prompt = positionals.join(" ").trim();

if (!prompt) {
  console.error(USAGE);
  process.exit(1);
}

let workspacePath: string | undefined;
if (values.workspace) {
  workspacePath = resolve(values.workspace);
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    console.error(`error: workspace "${values.workspace}" is not an existing directory`);
    process.exit(1);
  }
}

const mcpServers = workspacePath
  ? {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", workspacePath],
      },
    }
  : undefined;

const result = await runOnce(prompt, {
  systemPrompt: values.system,
  model: values.model,
  mcpServers,
  permissionMode: mcpServers ? "bypassPermissions" : undefined,
  allowDangerouslySkipPermissions: mcpServers ? true : undefined,
});

console.log(result);
