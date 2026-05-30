// biome-ignore-all lint/suspicious/noTemplateCurlyInString: tests assert ${VAR} interpolation in plain strings

import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";
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

  test("throws when an env var is undefined", () => {
    expect(() => interpolateEnv("${MISSING}", {})).toThrow(/undefined env vars: MISSING/);
  });

  test("throws when env value is not a string", () => {
    expect(() => interpolateEnv("${X}", { X: 42 as unknown as string })).toThrow();
    expect(() => interpolateEnv("${X}", { X: (() => "fn") as unknown as string })).toThrow();
  });

  test("reports every undefined env var in a single error", () => {
    expect(() => interpolateEnv({ a: "${A}", b: "${B}" }, {})).toThrow(/undefined env vars: A, B/);
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

  test("preserves non-plain objects like Date without flattening them", () => {
    const d = new Date("2026-12-31T00:00:00Z");
    const out = interpolateEnv({ created: d, name: "${X}" }, { X: "y" }) as {
      created: Date;
      name: string;
    };
    expect(out.created).toBe(d);
    expect(out.name).toBe("y");
  });
});

describe("ResidentConfigSchema", () => {
  test("accepts an empty config with defaults", () => {
    const cfg = ResidentConfigSchema.parse({});
    expect(cfg.mention.max_concurrent).toBe(10);
    expect(cfg.mention.allowed_users).toBeNull();
    expect(cfg.shutdown.drain_timeout_ms).toBe(60_000);
    expect(cfg.runner.system_prompt).toBeUndefined();
    expect(cfg.triggers.alerts).toEqual([]);
    expect(cfg.mcp_servers).toEqual({});
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

  test("resolves and validates runner.workspace.path", () => {
    expect(() =>
      ResidentConfigSchema.parse({ runner: { workspace: { path: "/no/such/dir/exists/here" } } }),
    ).toThrow(/not an existing directory/);
    const cfg = ResidentConfigSchema.parse({ runner: { workspace: { path: "." } } });
    expect(cfg.runner.workspace?.path).toBe(resolvePath("."));
  });

  test("rejects empty allowed_users (use null for allow-all)", () => {
    expect(() => ResidentConfigSchema.parse({ mention: { allowed_users: [] } })).toThrow(
      /allowed_users cannot be empty/,
    );
  });

  test("rejects duplicate mcp_servers entries", () => {
    expect(() =>
      ResidentConfigSchema.parse({
        mcp_servers: [
          { name: "fs", command: "a" },
          { name: "fs", command: "b" },
        ],
      }),
    ).toThrow(/duplicate mcp_servers entry: fs/);
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
    expect(Object.keys(cfg.mcp_servers)).toEqual(["fs"]);
    expect(cfg.mcp_servers.fs?.env).toEqual({ K: "v" });
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
