import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runOnce } from "./agent/runner";

const USAGE =
  "usage: resident [-s|--system <prompt>] [-m|--model <name>] [-w|--workspace <dir>] <prompt>";

try {
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
  if (values.workspace !== undefined) {
    if (values.workspace === "") {
      throw new Error("workspace path must not be empty");
    }
    workspacePath = resolve(values.workspace);
    if (!statSync(workspacePath, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`workspace "${values.workspace}" is not an existing directory`);
    }
  }

  const mcpServers = workspacePath
    ? {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem@2026.1.14", workspacePath],
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
