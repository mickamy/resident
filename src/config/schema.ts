import { statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";

// Variables that change how a process loads code or resolves binaries.
// Letting a config file inject these into spawned subprocesses is effectively code execution.
const DANGEROUS_ENV_KEYS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "NODE_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_CONNECT_TO",
  "PATH",
]);

const McpStdioServerEntrySchema = z
  .object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z
      .record(z.string(), z.string())
      .optional()
      .refine(
        (env) => !env || !Object.keys(env).some((k) => DANGEROUS_ENV_KEYS.has(k.toUpperCase())),
        "env may not contain runtime/loader variables (LD_PRELOAD, NODE_OPTIONS, PATH, etc.)",
      ),
  })
  .strict();

const McpStdioServersSchema = z
  .array(McpStdioServerEntrySchema)
  .default([])
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (const [i, entry] of arr.entries()) {
      if (seen.has(entry.name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate mcp_servers entry: ${entry.name}`,
          path: [i, "name"],
        });
      }
      seen.add(entry.name);
    }
  })
  .transform((arr) => {
    const record: Record<string, Omit<z.infer<typeof McpStdioServerEntrySchema>, "name">> = {};
    for (const { name, ...rest } of arr) {
      record[name] = rest;
    }
    return record;
  });

const AlertTriggerSchema = z
  .object({
    channels: z.array(z.string().min(1)).min(1),
    app_ids: z.array(z.string().min(1)).min(1),
    prompt: z.string().optional(),
  })
  .strict();

const AlertTriggersSchema = z
  .array(AlertTriggerSchema)
  .default([])
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (const [i, entry] of arr.entries()) {
      const key = `${[...entry.channels].sort().join(",")}|${[...entry.app_ids].sort().join(",")}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate triggers.alerts entry for channels=[${entry.channels.join(",")}] app_ids=[${entry.app_ids.join(",")}]`,
          path: [i],
        });
      }
      seen.add(key);
    }
  });

const MentionSchema = z
  .object({
    allowed_users: z
      .array(z.string().min(1))
      .nullable()
      .default(null)
      .refine(
        (v) => v === null || v.length > 0,
        "allowed_users cannot be empty; use null to allow every channel member",
      ),
    max_concurrent: z.number().int().positive().default(10),
    prompt: z.string().default(""),
  })
  .strict()
  .prefault({});

const ShutdownSchema = z
  .object({
    drain_timeout_ms: z.number().int().nonnegative().default(60_000),
  })
  .strict()
  .prefault({});

const RunnerWorkspaceSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict()
  .transform((v) => ({ path: resolvePath(v.path) }))
  .superRefine((v, ctx) => {
    if (!statSync(v.path, { throwIfNoEntry: false })?.isDirectory()) {
      ctx.addIssue({
        code: "custom",
        message: `runner.workspace.path "${v.path}" is not an existing directory`,
      });
    }
  });

const RunnerSchema = z
  .object({
    model: z.string().optional(),
    system_prompt: z.string().optional(),
    workspace: RunnerWorkspaceSchema.optional(),
  })
  .strict()
  .prefault({});

const TriggersSchema = z
  .object({
    alerts: AlertTriggersSchema,
  })
  .strict()
  .prefault({});

export const ResidentConfigSchema = z
  .object({
    mention: MentionSchema,
    shutdown: ShutdownSchema,
    runner: RunnerSchema,
    triggers: TriggersSchema,
    mcp_servers: McpStdioServersSchema,
  })
  .strict()
  .prefault({});

export type ResidentConfig = z.infer<typeof ResidentConfigSchema>;
export type McpStdioServerEntry = z.infer<typeof McpStdioServerEntrySchema>;
export type AlertTrigger = z.infer<typeof AlertTriggerSchema>;
