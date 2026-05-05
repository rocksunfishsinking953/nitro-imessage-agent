# Contributing

Thanks for considering a contribution. This is a small reference template, not a framework, so most contributions are bug fixes, documentation polish, or new tools/steps that other users will benefit from. Feature changes that bend the project away from "extremely simple iMessage agent on Nitro + Chat SDK + Vercel Workflow" are unlikely to land — open an issue first to discuss scope.

## Local setup

```bash
pnpm install
cp .env.example .env
# fill in AI_GATEWAY_API_KEY, SENDBLUE_*, optionally REDIS_URL for parity with prod
pnpm dev
```

See the [README](./README.md#local-setup-development) for the ngrok wiring needed to receive Sendblue webhooks locally.

## Before opening a PR

```sh
pnpm typecheck
pnpm lint
pnpm build
```

All three must pass. CI runs the same on every PR.

## Commit & PR conventions

- PR titles follow [Conventional Commits](https://www.conventionalcommits.org). The `Validate PR title` workflow enforces the allowed types (`feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `ci`, `build`, `style`, `revert`, `enhancement`, `breaking`).
- Subject lines start lowercase.
- Each PR should reference an issue when possible (`Resolves #123`).

## Project layout

See [README — Project layout](./README.md#project-layout). The two files you'll touch most often:

- [server/utils/agent-steps.ts](server/utils/agent-steps.ts) — model, prompt, AI Gateway wiring, evlog wrapping.
- [server/tools/index.ts](server/tools/index.ts) — tools registered with `generateText`.

Workflow files (under `workflows/`) cannot import Node-only modules. Anything that touches evlog, `node:fs`, native bindings, etc. must live in a `"use step"` function in `server/`.

## Adding a tool

1. Write an `async` function with the `'use step'` directive.
2. Register it in `tools` with a `description`, zod `inputSchema`, and `execute` reference. See [README — Add a tool](./README.md#add-a-tool).
3. Update the system prompt if the new tool needs framing.

## Reporting issues

Use the [bug report template](.github/ISSUE_TEMPLATE/bug-report.yml). Include:
- Sendblue plan tier (free shared / dedicated / enterprise)
- The Vercel Workflow run ID (visible in the Vercel dashboard) when the bug is in a workflow run.
- The wide-event log line for the failing webhook/step if you have evlog draining configured.
