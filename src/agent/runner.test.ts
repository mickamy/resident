import { describe, expect, mock, test } from "bun:test";

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt }: { prompt: string }) => {
    const gen = (async function* () {
      if (prompt === "throw") {
        yield {
          type: "result",
          subtype: "error_during_execution",
          errors: ["something went wrong"],
        };
        return;
      }
      if (prompt === "no-result") {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "thinking..." }] },
        };
        return;
      }
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "thinking..." }] },
      };
      yield {
        type: "result",
        subtype: "success",
        result: `echo: ${prompt}`,
      };
    })();
    return Object.assign(gen, { close: () => {} });
  },
}));

const { runOnce } = await import("./runner");

describe("runOnce", () => {
  test("returns the final result text from the SDK result message", async () => {
    const out = await runOnce("hello");
    expect(out).toBe("echo: hello");
  });

  test("throws when SDK yields a non-success result", async () => {
    await expect(runOnce("throw")).rejects.toThrow(/Agent run failed \(error_during_execution\)/);
  });

  test("throws when SDK completes without yielding a success result", async () => {
    await expect(runOnce("no-result")).rejects.toThrow(
      /Agent run completed without returning a success result/,
    );
  });
});
