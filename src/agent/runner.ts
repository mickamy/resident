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
  let finalText: string | null = null;

  const q = query({
    prompt,
    options: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      mcpServers: options.mcpServers,
      permissionMode: options.permissionMode,
      allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
    },
  });

  try {
    for await (const message of q) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          finalText = message.result;
        } else {
          const details = message.errors.join(", ") || "no details";
          throw new Error(`Agent run failed (${message.subtype}): ${details}`);
        }
      }
    }
  } finally {
    q.close();
  }

  if (finalText === null) {
    throw new Error("Agent run completed without returning a success result");
  }

  return finalText;
}
