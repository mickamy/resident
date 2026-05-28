import { describe, expect, test } from "bun:test";
import type { SayArguments, SayFn } from "@slack/bolt/dist/types/utilities";
import type { AppMentionEvent } from "@slack/types";
import { handleMention, stripBotMention } from "./app";

describe("stripBotMention", () => {
  test("removes only the bot's own mention", () => {
    expect(stripBotMention("<@U_BOT> hello", "U_BOT")).toBe("hello");
  });

  test("preserves mentions of other users", () => {
    expect(stripBotMention("<@U_BOT> ask <@U_ALICE> to look at it", "U_BOT")).toBe(
      "ask <@U_ALICE> to look at it",
    );
  });

  test("removes multiple bot mentions", () => {
    expect(stripBotMention("<@U_BOT> <@U_BOT> hi", "U_BOT")).toBe("hi");
  });

  test("removes bot mention with a display label", () => {
    expect(stripBotMention("<@U_BOT|resident> hello", "U_BOT")).toBe("hello");
  });

  test("preserves labeled mentions of other users", () => {
    expect(stripBotMention("<@U_BOT|resident> ping <@U_ALICE|alice>", "U_BOT")).toBe(
      "ping <@U_ALICE|alice>",
    );
  });
});

const baseEvent = {
  ts: "1234.5678",
  user: "U_USER",
  channel: "C_CHANNEL",
} as Partial<AppMentionEvent>;

function captureSays(): { sayCalls: SayArguments[]; say: SayFn } {
  const sayCalls: SayArguments[] = [];
  const say = (async (msg: string | SayArguments) => {
    if (typeof msg !== "string") sayCalls.push(msg);
  }) as unknown as SayFn;
  return { sayCalls, say };
}

describe("handleMention", () => {
  test("posts the runner's result back to the thread", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT> hello" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async (prompt) => `echo: ${prompt}`,
    });
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "echo: hello" }]);
  });

  test("replies in the existing thread when thread_ts is present", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: {
        ...baseEvent,
        text: "<@U_BOT> hello",
        thread_ts: "9000.0001",
      } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async (prompt) => `echo: ${prompt}`,
    });
    expect(sayCalls[0]?.thread_ts).toBe("9000.0001");
  });

  test("replies with placeholder when text is empty after strip", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT>" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async () => {
        throw new Error("runner must not be called");
      },
    });
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "(empty prompt)" }]);
  });

  test("posts the error message when runner throws", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT> hello" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "error: boom" }]);
  });

  test("logs to stderr when say fails, without re-throwing or retrying", async () => {
    let sayCount = 0;
    const errorCalls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    const say = (async () => {
      sayCount += 1;
      throw new Error("network down");
    }) as unknown as SayFn;
    try {
      await handleMention({
        event: { ...baseEvent, text: "<@U_BOT> hi" } as AppMentionEvent,
        say,
        botUserId: "U_BOT",
        run: async () => "ok",
      });
    } finally {
      console.error = originalError;
    }
    expect(sayCount).toBe(1);
    expect(errorCalls.length).toBeGreaterThan(0);
  });
});
