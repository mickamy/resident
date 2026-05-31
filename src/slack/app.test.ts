import { describe, expect, test } from "bun:test";
import type { SayArguments, SayFn } from "@slack/bolt/dist/types/utilities";
import type { AppMentionEvent } from "@slack/types";
import type { AlertTrigger } from "../config/schema";
import { findAlertTrigger, getAlertText, handleAlert, handleMention, stripBotMention } from "./app";

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

  test("falls back to (no response) when the runner returns whitespace-only text", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT> hi" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async () => "   \n  ",
    });
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "(no response)" }]);
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

  test("does not reply when text is empty after strip", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT>" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      run: async () => {
        throw new Error("runner must not be called");
      },
    });
    expect(sayCalls).toEqual([]);
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
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "error: see logs" }]);
  });

  test("skips mention when allowedUsers is set and event.user is not in it", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT> hello", user: "U_BOB" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      allowedUsers: new Set(["U_ALICE"]),
      run: async () => {
        throw new Error("runner must not be called");
      },
    });
    expect(sayCalls).toEqual([]);
  });

  test("processes mention when event.user is in allowedUsers", async () => {
    const { sayCalls, say } = captureSays();
    await handleMention({
      event: { ...baseEvent, text: "<@U_BOT> hello", user: "U_ALICE" } as AppMentionEvent,
      say,
      botUserId: "U_BOT",
      allowedUsers: new Set(["U_ALICE"]),
      run: async (prompt) => `echo: ${prompt}`,
    });
    expect(sayCalls).toEqual([{ thread_ts: "1234.5678", text: "echo: hello" }]);
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

const TRIGGERS: AlertTrigger[] = [
  { channels: ["C_OPS"], app_ids: ["A_DATADOG"] },
  { channels: ["C_INC"], app_ids: ["A_AWS"], prompt: "Be brief." },
];

describe("getAlertText", () => {
  test("returns top-level text when present", () => {
    expect(getAlertText({ text: "[CRIT] CPU 99%" })).toBe("[CRIT] CPU 99%");
  });

  test("aggregates attachment pretext/title/text/fallback under top-level text", () => {
    const out = getAlertText({
      text: "alert summary",
      attachments: [
        {
          pretext: "Datadog Alert",
          title: "Triggered: HighCPU",
          text: "host=web-01 cpu=99",
          fallback: "fallback line",
        },
      ],
    });
    expect(out).toBe(
      [
        "alert summary",
        "Datadog Alert",
        "Triggered: HighCPU",
        "host=web-01 cpu=99",
        "fallback line",
      ].join("\n"),
    );
  });

  test("returns attachment fields when top-level text is empty", () => {
    expect(
      getAlertText({
        text: "",
        attachments: [{ title: "Triggered: HighCPU", text: "host=web-01" }],
      }),
    ).toBe("Triggered: HighCPU\nhost=web-01");
  });

  test("includes attachment fields[*].title and fields[*].value", () => {
    expect(
      getAlertText({
        attachments: [
          {
            title: "Triggered",
            fields: [
              { title: "host", value: "web-01" },
              { title: "metric", value: "cpu.util" },
              { title: "threshold", value: "> 90%" },
            ],
          },
        ],
      }),
    ).toBe("Triggered\nhost\nweb-01\nmetric\ncpu.util\nthreshold\n> 90%");
  });

  test("skips non-string and blank attachment fields", () => {
    expect(
      getAlertText({
        attachments: [{ title: "", text: "real body", pretext: undefined, fallback: 42 }],
      }),
    ).toBe("real body");
  });

  test("returns empty string when nothing usable is present", () => {
    expect(getAlertText({})).toBe("");
    expect(getAlertText({ text: "   ", attachments: [] })).toBe("");
  });
});

describe("findAlertTrigger", () => {
  test("matches channel + app_id pair", () => {
    expect(findAlertTrigger({ channel: "C_OPS", app_id: "A_DATADOG" }, TRIGGERS)).toBe(TRIGGERS[0]);
  });

  test("returns the trigger that carries the prompt override", () => {
    expect(findAlertTrigger({ channel: "C_INC", app_id: "A_AWS" }, TRIGGERS)?.prompt).toBe(
      "Be brief.",
    );
  });

  test("returns undefined when channel mismatches", () => {
    expect(findAlertTrigger({ channel: "C_OTHER", app_id: "A_DATADOG" }, TRIGGERS)).toBeUndefined();
  });

  test("returns undefined when app_id mismatches", () => {
    expect(findAlertTrigger({ channel: "C_OPS", app_id: "A_OTHER" }, TRIGGERS)).toBeUndefined();
  });

  test("returns undefined when channel or app_id is missing", () => {
    expect(findAlertTrigger({ app_id: "A_DATADOG" }, TRIGGERS)).toBeUndefined();
    expect(findAlertTrigger({ channel: "C_OPS" }, TRIGGERS)).toBeUndefined();
  });
});

const alertEvent = (overrides: Partial<{ text: string; thread_ts: string }> = {}) => ({
  text: overrides.text ?? "[CRIT] DB CPU 99%",
  ts: "2222.3333",
  thread_ts: overrides.thread_ts,
  channel: "C_OPS",
});

describe("handleAlert", () => {
  test("posts the runner's result with trigger.prompt as systemPrompt", async () => {
    const { sayCalls, say } = captureSays();
    let seenSystemPrompt: string | undefined;
    await handleAlert({
      event: alertEvent(),
      say,
      trigger: { channels: ["C_OPS"], app_ids: ["A_DATADOG"], prompt: "TRIGGER_PROMPT" },
      defaultSystemPrompt: "DEFAULT_PROMPT",
      run: async (prompt, opts) => {
        seenSystemPrompt = opts?.systemPrompt;
        return `triaged: ${prompt}`;
      },
    });
    expect(seenSystemPrompt).toBe("TRIGGER_PROMPT");
    expect(sayCalls).toEqual([{ thread_ts: "2222.3333", text: "triaged: [CRIT] DB CPU 99%" }]);
  });

  test("falls back to defaultSystemPrompt when trigger.prompt is unset", async () => {
    let seenSystemPrompt: string | undefined;
    await handleAlert({
      event: alertEvent(),
      say: captureSays().say,
      trigger: { channels: ["C_OPS"], app_ids: ["A_DATADOG"] },
      defaultSystemPrompt: "DEFAULT_PROMPT",
      run: async (_p, opts) => {
        seenSystemPrompt = opts?.systemPrompt;
        return "ok";
      },
    });
    expect(seenSystemPrompt).toBe("DEFAULT_PROMPT");
  });

  test("uses event.thread_ts when present", async () => {
    const { sayCalls, say } = captureSays();
    await handleAlert({
      event: alertEvent({ thread_ts: "9999.0001" }),
      say,
      trigger: { channels: ["C_OPS"], app_ids: ["A_DATADOG"] },
      defaultSystemPrompt: "x",
      run: async () => "ok",
    });
    expect(sayCalls[0]?.thread_ts).toBe("9999.0001");
  });

  test("does not reply when the alert text is empty", async () => {
    const { sayCalls, say } = captureSays();
    await handleAlert({
      event: alertEvent({ text: "   " }),
      say,
      trigger: { channels: ["C_OPS"], app_ids: ["A_DATADOG"] },
      defaultSystemPrompt: "x",
      run: async () => {
        throw new Error("runner must not be called");
      },
    });
    expect(sayCalls).toEqual([]);
  });

  test("posts a generic error and logs when the runner throws", async () => {
    const errorCalls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    const { sayCalls, say } = captureSays();
    try {
      await handleAlert({
        event: alertEvent(),
        say,
        trigger: { channels: ["C_OPS"], app_ids: ["A_DATADOG"] },
        defaultSystemPrompt: "x",
        run: async () => {
          throw new Error("boom");
        },
      });
    } finally {
      console.error = originalError;
    }
    expect(sayCalls).toEqual([{ thread_ts: "2222.3333", text: "error: see logs" }]);
    expect(errorCalls.length).toBeGreaterThan(0);
  });
});
