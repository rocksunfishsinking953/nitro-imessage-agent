import { generateText, stepCountIs } from 'ai'
import { createRequestLogger, initLogger } from 'evlog'
import { createAILogger, createEvlogIntegration } from 'evlog/ai'
import { tools } from '../tools/index.ts'
import { useBot } from './bot.ts'

const SERVICE_NAME = 'nitro-imessage-agent'
const MODEL = 'google/gemini-3-flash'
const SYSTEM_PROMPT = `You are a friendly assistant texting back over iMessage. Keep replies short, casual, and plain text. No markdown.

When recommending Nuxt modules, prefer official modules (type "official", maintained by the Nuxt core team) over community ones unless the user explicitly asks for alternatives or no official option exists.`

// Approximate AI Gateway pricing per 1M tokens (in USD). Adjust as needed.
const COST_MAP = {
  'gemini-3-flash': { input: 0.1, output: 0.4 },
  'claude-sonnet-4.5': { input: 3, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

let _loggerInitialized = false
function ensureLoggerInit(): void {
  if (_loggerInitialized) return
  initLogger({ env: { service: SERVICE_NAME } })
  _loggerInitialized = true
}

export async function generateReply(prompt: string): Promise<string> {
  'use step'

  ensureLoggerInit()

  const log = createRequestLogger({})
  log.set({ step: 'generateReply', model: MODEL, prompt })

  const ai = createAILogger(log, {
    cost: COST_MAP,
    toolInputs: { maxLength: 500 },
  })

  try {
    const { text } = await generateText({
      model: ai.wrap(MODEL),
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      stopWhen: stepCountIs(10),
      experimental_telemetry: {
        isEnabled: true,
        integrations: [createEvlogIntegration(ai)],
      },
    })
    log.set({ reply: text })
    return text
  } finally {
    log.emit()
  }
}

export async function postReply(threadId: string, text: string): Promise<void> {
  'use step'

  if (!text.trim()) return

  const { sendblue } = useBot()
  await sendblue.postMessage(threadId, text)
}
