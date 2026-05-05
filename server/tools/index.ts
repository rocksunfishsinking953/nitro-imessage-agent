import { z } from 'zod'

interface NuxtModule {
  name: string
  description: string
  repo?: string
  npm?: string
  category?: string
  type?: string
  stats?: { downloads?: number, stars?: number, version?: string }
}

interface NuxtModulesResponse {
  modules: NuxtModule[]
  stats?: { modules?: number }
}

async function getCurrentTime({ timezone }: { timezone: string }): Promise<string> {
  'use step'

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date())
}

async function searchNuxtModules({
  query,
  limit = 5,
}: {
  query: string
  limit?: number
}): Promise<{ count: number, modules: Array<Pick<NuxtModule, 'name' | 'description' | 'npm' | 'category' | 'type'> & { stars?: number, downloads?: number }> }> {
  'use step'

  const res = await fetch('https://api.nuxt.com/modules')
  if (!res.ok) {
    throw new Error(`Failed to fetch Nuxt modules: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as NuxtModulesResponse
  const q = query.toLowerCase()

  const matches = data.modules
    .filter((m) => {
      const haystack = `${m.name} ${m.description ?? ''} ${m.category ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
    .sort((a, b) => {
      const aOfficial = a.type === 'official' ? 0 : 1
      const bOfficial = b.type === 'official' ? 0 : 1
      if (aOfficial !== bOfficial) return aOfficial - bOfficial
      return (b.stats?.stars ?? 0) - (a.stats?.stars ?? 0)
    })
    .slice(0, limit)
    .map(m => ({
      name: m.name,
      description: m.description,
      npm: m.npm,
      category: m.category,
      type: m.type,
      stars: m.stats?.stars,
      downloads: m.stats?.downloads,
    }))

  return { count: matches.length, modules: matches }
}

export const tools = {
  getCurrentTime: {
    description: 'Get the current date and time in a specific IANA timezone (e.g. "Europe/Paris"). Use when the user asks what time it is.',
    inputSchema: z.object({
      timezone: z.string().describe('IANA timezone identifier'),
    }),
    execute: getCurrentTime,
  },
  searchNuxtModules: {
    description: 'Search the Nuxt module registry (https://api.nuxt.com/modules) for modules matching a query. Use when the user asks about Nuxt modules, Nuxt ecosystem, or how to add a feature to a Nuxt app. Results are sorted with official modules (type=official, maintained by the Nuxt core team) first, then by GitHub stars. Each result includes name, description, npm package, category, type, stars, and downloads.',
    inputSchema: z.object({
      query: z.string().describe('Free-text query to match against module name, description, and category (e.g. "seo", "auth", "i18n", "image")'),
      limit: z.number().int().min(1).max(10).optional().describe('Max number of results (default 5, capped at 10)'),
    }),
    execute: searchNuxtModules,
  },
}
