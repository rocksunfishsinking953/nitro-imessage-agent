import { generateReply, postReply } from '../server/utils/agent-steps.ts'

export async function replyToMessage(threadId: string, prompt: string): Promise<void> {
  'use workflow'

  const text = await generateReply(prompt)
  if (text) await postReply(threadId, text)
}
