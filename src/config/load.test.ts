// biome-ignore-all lint/suspicious/noTemplateCurlyInString: tests assert ${VAR} interpolation in plain strings
import { describe, expect, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { interpolateEnv } from "./load";
import { ResidentConfigSchema } from "./schema";

describe("interpolateEnv", () => {
  test("substitutes ${VAR} with env value", () => {
    expect(interpolateEnv("hello ${USER}", { USER: "alice" })).toBe("hello alice");
  });

  test("substitutes multiple occurrences in the same string", () => {
    expect(interpolateEnv("${A}-${B}-${A}", { A: "x", B: "y" })).toBe("x-y-x");
  });

  test("replaces unmatched vars with an empty string", () => {
    expect(interpolateEnv("${MISSING}", {})).toBe("");
  });

  test("does not touch strings without ${VAR}", () => {
    expect(interpolateEnv("plain text", { X: "1" })).toBe("plain text");
  });

  test("recurses into nested objects and arrays", () => {
    expect(interpolateEnv({ a: ["${X}", "lit", { b: "${Y}" }] }, { X: "vx", Y: "vy" })).toEqual({
      a: ["vx", "lit", { b: "vy" }],
    });
  });

  test("leaves non-string scalars unchanged", () => {
    expect(interpolateEnv(42, {})).toBe(42);
    expect(interpolateEnv(true, {})).toBe(true);
    expect(interpolateEnv(null, {})).toBe(null);
  });
});

describe("ResidentConfigSchema", () => {
  test("accepts an empty config with defaults", () => {
    const cfg = ResidentConfigSchema.parse({});
    expect(cfg.mention.max_concurrent).toBe(10);
    expect(cfg.mention.allowed_users).toBeNull();
    expect(cfg.shutdown.drain_timeout_ms).toBe(60_000);
    expect(cfg.runner.system_prompt).toBe("");
    expect(cfg.triggers.alerts).toEqual([]);
    expect(cfg.mcp_servers).toEqual([]);
  });

  test("parses a minimal TOML config", () => {
    const toml = `
[mention]
allowed_users = ["U_ALICE", "U_BOB"]
max_concurrent = 5
`;
    const cfg = ResidentConfigSchema.parse(parseToml(toml));
    expect(cfg.mention.allowed_users).toEqual(["U_ALICE", "U_BOB"]);
    expect(cfg.mention.max_concurrent).toBe(5);
  });

  test("rejects non-positive max_concurrent", () => {
    expect(() => ResidentConfigSchema.parse({ mention: { max_concurrent: 0 } })).toThrow();
    expect(() => ResidentConfigSchema.parse({ mention: { max_concurrent: -1 } })).toThrow();
  });

  test("rejects negative drain_timeout_ms", () => {
    expect(() => ResidentConfigSchema.parse({ shutdown: { drain_timeout_ms: -1 } })).toThrow();
  });

  test("parses alert triggers and mcp_servers", () => {
    const cfg = ResidentConfigSchema.parse({
      triggers: { alerts: [{ channels: ["C1"], app_ids: ["A1"], prompt: "p.md" }] },
      mcp_servers: [{ name: "fs", command: "npx", args: ["-y", "@mcp/server"], env: { K: "v" } }],
    });
    expect(cfg.triggers.alerts[0]).toEqual({
      channels: ["C1"],
      app_ids: ["A1"],
      prompt: "p.md",
    });
    expect(cfg.mcp_servers).toHaveLength(1);
    expect(cfg.mcp_servers[0]?.env).toEqual({ K: "v" });
  });

  test("rejects an alert trigger with empty channels or app_ids", () => {
    expect(() =>
      ResidentConfigSchema.parse({
        triggers: { alerts: [{ channels: [], app_ids: ["A1"] }] },
      }),
    ).toThrow();
    expect(() =>
      ResidentConfigSchema.parse({
        triggers: { alerts: [{ channels: ["C1"], app_ids: [] }] },
      }),
    ).toThrow();
  });
});
