import { describe, expect, mock, test } from "bun:test";

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt }: { prompt: string }) =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "thinking..." }] },
      };
      yield {
        type: "result",
        subtype: "success",
        result: `echo: ${prompt}`,
      };
    })(),
}));

const { runOnce } = await import("./runner");

describe("runOnce", () => {
  test("returns the final result text from the SDK result message", async () => {
    const out = await runOnce("hello");
    expect(out).toBe("echo: hello");
  });
});
