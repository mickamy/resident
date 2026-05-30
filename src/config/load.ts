import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { type ResidentConfig, ResidentConfigSchema } from "./schema";

const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  const missing: string[] = [];
  const out = walk(value, env, missing);
  if (missing.length > 0) {
    const unique = [...new Set(missing)];
    throw new Error(`config references undefined env vars: ${unique.join(", ")}`);
  }
  return out;
}

function walk(value: unknown, env: NodeJS.ProcessEnv, missing: string[]): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_RE, (_, name) => {
      const v = env[name];
      // Guard against inherited prototype properties (e.g., env.toString returning a function).
      if (typeof v !== "string") {
        missing.push(name);
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, env, missing));
  }
  if (value && typeof value === "object") {
    // smol-toml parses TOML datetimes into Date objects; only recurse into
    // plain objects so we don't strip non-plain instances down to `{}`.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walk(v, env, missing);
    }
    return out;
  }
  return value;
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResidentConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = parseToml(raw);
  const interpolated = interpolateEnv(parsed, env);
  return ResidentConfigSchema.parse(interpolated);
}
