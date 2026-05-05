# nitro-imessage-agent

A **durable** iMessage AI agent built on:

- [Nitro](https://nitro.build) v3 — the API server
- [Chat SDK](https://chat-sdk.dev) + [`chat-adapter-sendblue`](https://chat-sdk.dev/adapters/sendblue) — message routing over [Sendblue](https://sendblue.com)
- [Vercel AI SDK](https://sdk.vercel.ai) + [AI Gateway](https://vercel.com/docs/ai-gateway) — LLM replies, swap models with one constant
- [Vercel Workflow](https://useworkflow.dev) — durable orchestration with retryable `"use step"` units
- [evlog](https://www.evlog.dev) — structured wide-event logging with first-class AI SDK integration (token usage, tool calls, cost estimation)

A user texts your Sendblue number, Sendblue posts a webhook to this server, the Chat SDK dispatches the message, a workflow runs an agent step (LLM + tools), and the final reply is sent back through Sendblue. Each step is retryable on its own, so a transient LLM error or send hiccup never drops the inbound message.

```
   ┌─────────┐    ┌──────────────┐    ┌──────────────┐   ┌────────────┐
   │ user    │───▶│   Sendblue   │───▶│  POST /api/  │──▶│ Chat SDK   │
   │iMessage │    │  (cloud)     │    │webhooks/...  │   │ onMention  │
   └─────────┘    └──────────────┘    └──────────────┘   └─────┬──────┘
        ▲                                                       │
        │                                                       ▼
        │                                           ┌────────────────────────┐
        │                                           │ workflow start(...)    │
        │                                           └───────────┬────────────┘
        │                                                       ▼
        │                                           ┌────────────────────────┐
        │                                           │ generateReply(use step)│
        │                                           │  ├── LLM (AI Gateway)  │
        │                                           │  ├── tools roundtrip   │
        │                                           │  └── evlog wide event  │
        │                                           └───────────┬────────────┘
        │                                                       ▼
        │                                           ┌────────────────────────┐
        └───────────────────────────────────────────┤ postReply (use step)   │
                  Sendblue postMessage              │ sendblue.postMessage   │
                                                    └────────────────────────┘
```

## Architecture

The Sendblue cloud holds your dedicated phone line and forwards inbound iMessages to your server as HTTPS webhooks. Outbound replies go back through the same API. There is no gateway listener to keep alive, no Mac in production, and no cron.

The [server/api/webhooks/sendblue.post.ts](server/api/webhooks/sendblue.post.ts) route receives every webhook and hands it to `chat.webhooks.sendblue(request)`. The Chat SDK then fires `onNewMention` (first DM in a thread) or `onSubscribedMessage` (every following DM) on the bot — handlers registered in [server/plugins/imessage.ts](server/plugins/imessage.ts) call `start(replyToMessage, [thread.id, message.text])` to queue a workflow.

[workflows/reply.ts](workflows/reply.ts) is a thin `"use workflow"` function that just chains two retryable steps from [server/utils/agent-steps.ts](server/utils/agent-steps.ts):

1. **`generateReply` step** — calls `generateText` against the Vercel AI Gateway. Tools registered in [server/tools/](server/tools/) are looped with `stopWhen: stepCountIs(5)` (LLM → tool → LLM until done). The model is wrapped with `evlog/ai`'s `ai.wrap()` and `experimental_telemetry.integrations` carries `createEvlogIntegration(ai)` so token usage, tool execution timing, and estimated cost are captured into a wide event.
2. **`postReply` step** — calls `sendblue.postMessage`. Independent retryability: a transient send error doesn't re-run the LLM call.

Workflow functions can't import Node-only packages like evlog directly, so the AI SDK calls live in steps (which run as normal Node) — that's why the actual logic is in `server/utils/agent-steps.ts` and the workflow file just orchestrates.

## Local setup (development)

Sendblue is webhook-based, so to receive iMessages on your local machine you expose `localhost:3000` through a public tunnel — we use **ngrok**.

**Prerequisites**

- Node 20+ (use `corepack enable` to get pnpm)
- A Sendblue account with API credentials and a provisioned phone line ([sendblue.com/pricing](https://sendblue.com/pricing) — the AI Agent plan at $100/month/line includes webhooks)
- [ngrok](https://ngrok.com/download) installed and authenticated (`ngrok config add-authtoken <your-token>`)

**Install & run**

```bash
pnpm install
cp .env.example .env
# fill in AI_GATEWAY_API_KEY + SENDBLUE_API_KEY + SENDBLUE_API_SECRET +
# SENDBLUE_FROM_NUMBER + SENDBLUE_WEBHOOK_SECRET
pnpm dev
```

In a second terminal:

```bash
ngrok http 3000
```

Copy the `https://<id>.ngrok-free.app` URL ngrok prints, then in the [Sendblue dashboard](https://dashboard.sendblue.com/) set the inbound webhook URL to:

```
https://<id>.ngrok-free.app/api/webhooks/sendblue
```

**Test**

Text your Sendblue number from any phone. The dev server logs the inbound webhook, the workflow run starts, and a reply lands on your phone. Try `"what time is it in Paris?"` to validate the `getCurrentTime` tool path.

## Production setup

Sendblue runs in the cloud and just talks HTTP, so production is the same as local minus the tunnel:

1. Deploy this repo to [Vercel](https://vercel.com) (or any Node host that supports Nitro): `pnpm dlx vercel`.
2. Set the same five env vars in your hosting provider's environment settings (Vercel → Project → Settings → Environment Variables).
3. In the Sendblue dashboard, point the inbound webhook URL at your production deployment:

   ```
   https://<your-app>.vercel.app/api/webhooks/sendblue
   ```

That's it — no `vercel.json`, no cron, no Mac. The Vercel function spins up on each webhook and the Workflow runs durably in the background.

> **Why Sendblue and not Photon?** Photon's [Spectrum dashboard](https://app.photon.codes/) gives you a `Project ID` + `Secret Key` for the new `spectrum-ts` SDK, which is **not compatible** with `chat-adapter-imessage`. The latter still uses the older `@photon-ai/advanced-imessage-kit` Enterprise SDK, which requires negotiated `serverUrl` + `apiKey` credentials from Photon sales. Sendblue gives you a working dedicated US line, webhooks, and SMS fallback — self-serve and no KYC for A2P — which is the cleanest path to production today.

## Configuration reference

| Env var | Required | When |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | yes | Always. Auto-detected by the AI SDK (no `NITRO_` prefix). |
| `SENDBLUE_API_KEY` | yes | Always. Auto-detected by the adapter from process env. |
| `SENDBLUE_API_SECRET` | yes | Always. Auto-detected by the adapter. |
| `SENDBLUE_FROM_NUMBER` | yes | Your provisioned Sendblue line in E.164 format (e.g. `+14155551234`). |
| `SENDBLUE_WEBHOOK_SECRET` | recommended | If set in the Sendblue dashboard, the adapter validates every incoming webhook against it. Set the same value here. |

## Switching the model

Edit one constant in [server/utils/agent-steps.ts](server/utils/agent-steps.ts):

```ts
const MODEL = 'google/gemini-3-flash'
```

Any [supported AI Gateway slug](https://vercel.com/ai-gateway/models) works. A few useful ones:

- `google/gemini-3-flash`
- `anthropic/claude-sonnet-4.5`
- `openai/gpt-4o-mini`
- `xai/grok-4`

The AI SDK reads `AI_GATEWAY_API_KEY` from the environment automatically, so no provider plumbing is needed.

## Extending the agent

### Add a tool

Tools live in [server/tools/index.ts](server/tools/index.ts). Each tool is a `description` + `inputSchema` (zod) + `execute` function. The `"use step"` directive on the execute body makes every tool call a retryable, observable workflow step.

Example (from this repo):

```ts
import { z } from 'zod'

// eslint-disable-next-line require-await
async function getCurrentTime({ timezone }: { timezone: string }): Promise<string> {
  'use step'

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date())
}

export const tools = {
  getCurrentTime: {
    description: 'Get the current date and time in a specific IANA timezone…',
    inputSchema: z.object({
      timezone: z.string().describe('IANA timezone identifier'),
    }),
    execute: getCurrentTime,
  },
}
```

To add another tool, write a new step function and register it in the `tools` map. The agent picks it up automatically — `generateText` discovers them at call time.

### Change the system prompt

Edit `SYSTEM_PROMPT` in [server/utils/agent-steps.ts](server/utils/agent-steps.ts).

### Add a workflow step

Any function annotated with `"use step"` becomes a retryable, durable step. Wrap higher-level orchestration in a `"use workflow"` function and call steps from it. See [Workflows and steps](https://useworkflow.dev/docs/foundations/workflows-and-steps) for the full mental model. [workflows/reply.ts](workflows/reply.ts) is the canonical example: a thin `"use workflow"` function chaining `generateReply` and `postReply` steps from [server/utils/agent-steps.ts](server/utils/agent-steps.ts).

> Workflow functions can't import Node-only modules (evlog, native bindings, etc.). Keep heavy logic in `"use step"` files outside `workflows/` and import them into the workflow.

### Tweak AI observability

`createAILogger(log, { cost })` in [server/utils/agent-steps.ts](server/utils/agent-steps.ts) controls token-cost estimation. Update `COST_MAP` with your real Gateway pricing, or set `cost` to `undefined` to disable. The wide event under the `ai.*` namespace already includes `inputTokens`, `outputTokens`, `toolCalls`, `tools[]` (timing per tool from `createEvlogIntegration`), `msToFirstChunk`, `tokensPerSecond`, and `estimatedCost`. See [evlog AI SDK docs](https://www.evlog.dev/logging/ai-sdk/overview) for the full field list.

### Add a drain (Axiom, OTLP, Sentry, …)

The Nitro evlog module exposes a `evlog:drain` hook. Drop a server plugin to forward wide events to your observability backend:

```ts
// server/plugins/evlog-drain.ts
import { createAxiomDrain } from 'evlog/axiom'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createAxiomDrain())
})
```

Other adapters: `evlog/otlp`, `evlog/hyperdx`, `evlog/posthog`, `evlog/sentry`, `evlog/better-stack`, `evlog/datadog`. Full list at [evlog adapters](https://www.evlog.dev/adapters).

## Project layout

```
workflows/
  reply.ts                          # "use workflow" — chains generateReply + postReply
server/
  api/
    index.ts                        # GET /api — health check
    webhooks/sendblue.post.ts       # POST /api/webhooks/sendblue — Sendblue inbound webhook
  plugins/imessage.ts               # Chat SDK handlers, queues the workflow on each DM
  tools/index.ts                    # tools passed to generateText (use step)
  utils/agent-steps.ts              # generateReply + postReply steps; evlog AI wiring lives here
  utils/bot.ts                      # Chat instance + Sendblue adapter (singleton)
nitro.config.ts                     # registers `workflow/nitro` and `evlog/nitro/v3`
```

## Observability

Two layers, both opt-in through this repo's defaults:

**Workflow runs** — durable execution, step retries, replay debugging:

```bash
pnpm workflow:web         # local dashboard with run history, step retries, live logs
npx workflow inspect runs # CLI
```

In production on Vercel, runs show up automatically in the Vercel dashboard.

**Wide events** — every webhook + every workflow step emits a structured wide event via [evlog](https://www.evlog.dev). The AI SDK integration captures token usage, tool execution timing, and cost estimation under the `ai.*` namespace automatically. By default events go to console (pretty in dev, JSON in prod). Configure a drain (Axiom, OTLP, Sentry, …) to ship them to your backend — see "Add a drain" above.

## Scripts

```sh
pnpm dev        # start the Nitro dev server
pnpm build      # build for production
pnpm preview    # preview the production build
pnpm lint       # eslint
pnpm test       # vitest
pnpm typecheck  # tsc --noEmit
```

## References

- [`chat-adapter-sendblue`](https://chat-sdk.dev/adapters/sendblue) — adapter docs
- [Sendblue docs](https://docs.sendblue.com) — API, webhooks, line provisioning
- [Sendblue pricing](https://sendblue.com/pricing)
- [Chat SDK docs](https://chat-sdk.dev)
- [Vercel Workflow](https://useworkflow.dev) — durable execution model
- [Workflows and steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Vercel AI SDK](https://sdk.vercel.ai)
- [AI Gateway models](https://vercel.com/ai-gateway/models)
- [evlog](https://www.evlog.dev) — wide-event logging
- [evlog AI SDK integration](https://www.evlog.dev/logging/ai-sdk/overview)
- [evlog drain adapters](https://www.evlog.dev/adapters)
- [Nitro](https://nitro.build)
- [ngrok](https://ngrok.com/download)

## License

[Apache 2.0](./LICENSE) — Made by [@HugoRCD](https://github.com/HugoRCD).
