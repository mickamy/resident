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

const McpStdioServerSchema = z.object({
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
});

const AlertTriggerSchema = z.object({
  channels: z.array(z.string().min(1)).min(1),
  app_ids: z.array(z.string().min(1)).min(1),
  prompt: z.string().optional(),
});

const MentionSchema = z
  .object({
    allowed_users: z.array(z.string().min(1)).nullable().default(null),
    max_concurrent: z.number().int().positive().default(10),
    prompt: z.string().default(""),
  })
  .prefault({});

const ShutdownSchema = z
  .object({
    drain_timeout_ms: z.number().int().nonnegative().default(60_000),
  })
  .prefault({});

const RunnerWorkspaceSchema = z.object({
  path: z.string().min(1),
});

const RunnerSchema = z
  .object({
    model: z.string().optional(),
    system_prompt: z.string().default(""),
    workspace: RunnerWorkspaceSchema.optional(),
  })
  .prefault({});

const TriggersSchema = z
  .object({
    alerts: z.array(AlertTriggerSchema).default([]),
  })
  .prefault({});

export const ResidentConfigSchema = z
  .object({
    mention: MentionSchema,
    shutdown: ShutdownSchema,
    runner: RunnerSchema,
    triggers: TriggersSchema,
    mcp_servers: z.array(McpStdioServerSchema).default([]),
  })
  .prefault({});

export type ResidentConfig = z.infer<typeof ResidentConfigSchema>;
export type McpStdioServer = z.infer<typeof McpStdioServerSchema>;
export type AlertTrigger = z.infer<typeof AlertTriggerSchema>;
