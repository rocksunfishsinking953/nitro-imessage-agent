import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  serverDir: './server',
  modules: [
    'workflow/nitro',
    evlog({ env: { service: 'nitro-imessage-agent' } }),
  ],
})
