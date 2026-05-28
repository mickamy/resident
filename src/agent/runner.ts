import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

export type RunOptions = {
  systemPrompt?: string;
  model?: string;
  mcpServers?: Options["mcpServers"];
  permissionMode?: Options["permissionMode"];
  allowDangerouslySkipPermissions?: boolean;
};

export async function runOnce(prompt: string, options: RunOptions = {}): Promise<string> {
  let finalText = "";

  for await (const message of query({
    prompt,
    options: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      mcpServers: options.mcpServers,
      permissionMode: options.permissionMode,
      allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      finalText = message.result;
    }
  }

  return finalText;
}
