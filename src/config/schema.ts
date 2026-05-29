import { z } from "zod";

const McpStdioServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
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
