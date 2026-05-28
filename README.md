# resident

Slack-resident Claude bot for alert triage and `@mention` Q&A — built on
the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) and MCP.

> Status: early skeleton. Nothing is wired up to Slack yet.

## Installation

```bash
brew install mickamy/tap/resident
```

Or download a release archive directly from [Releases](https://github.com/mickamy/resident/releases) (
`resident-{linux,darwin}-{x64,arm64}.tar.gz`).

## Development

```bash
bun install
bun run src/index.ts "Say 'pong' and nothing else."
```

Useful scripts:

| script              | description                                 |
|---------------------|---------------------------------------------|
| `bun run dev`       | watch-mode entry                            |
| `bun test`          | unit tests                                  |
| `bun run typecheck` | `tsc --noEmit`                              |
| `bun run lint`      | Biome lint + format check                   |
| `bun run build`     | local single-binary build (`dist/resident`) |

## License

[MIT](LICENSE)
