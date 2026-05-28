import { parseArgs } from "node:util";
import { runOnce } from "./agent/runner";

const USAGE = "usage: resident [-s|--system <prompt>] [-m|--model <name>] <prompt>";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    system: { type: "string", short: "s" },
    model: { type: "string", short: "m" },
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

const result = await runOnce(prompt, {
  systemPrompt: values.system,
  model: values.model,
});

console.log(result);
