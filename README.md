# resident

Slack-resident Claude bot for alert triage and `@mention` Q&A — built on
the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) and MCP.

> Status: early skeleton. Nothing is wired up to Slack yet.

## Installation

```bash
brew install mickamy/tap/resident
```

Or download a release archive directly from [Releases](https://github.com/mickamy/resident/releases) (`resident-{linux,darwin}-{x64,arm64}.tar.gz`).

## Development

```bash
bun install
bun start "Say 'pong' and nothing else."
```

Useful scripts:

| script              | description                                 |
|---------------------|---------------------------------------------|
| `bun run dev`       | watch-mode entry                            |
| `bun test`          | unit tests                                  |
| `bun run typecheck` | `tsc --noEmit`                              |
| `bun run lint`      | Biome lint + format check                   |
| `bun run build`     | local single-binary build (`dist/resident`) |

## Operation

The daemon (`bun run daemon` / `src/daemon.ts`) is meant to run under a process supervisor — systemd, Docker `restart: always`, or equivalent.

- **Slack connectivity is self-healing.** `@slack/bolt` Socket Mode keeps a long-lived WebSocket to Slack with ping/pong heartbeats and reconnects automatically across short outages and Slack-side server rotations. Application code does not need to manage reconnection.
- **The process is not self-healing.** Any uncaught error (`uncaughtException` / `unhandledRejection`) is logged with its stack and the daemon exits with code `1`. The supervisor must restart it.

A reference systemd unit lives at [`examples/resident.service`](examples/resident.service). It sets `Restart=always`, journald logging, and uses an `EnvironmentFile` for secrets (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ANTHROPIC_API_KEY`).

## License

[MIT](LICENSE)
