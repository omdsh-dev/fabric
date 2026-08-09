import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dsh = (path: string): string => fileURLToPath(new URL(`../deepseek-harness/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@deepseek-ai/dsh-client-ui-command/client': dsh('packages/client/ui-command/src/client/index.ts'),
      '@deepseek-ai/dsh-client-ui-command/src/client/service.ts': dsh('packages/client/ui-command/src/client/service.ts'),
      '@deepseek-ai/dsh-client-ui-slash/client': dsh('packages/client/ui-slash/src/client/index.ts'),
      '@deepseek-ai/dsh-client-ui-slots': dsh('packages/client/ui-slots/src/index.ts'),
      '@deepseek-ai/dsh-client-ui-primitives': dsh('packages/client/ui-primitives/src/index.ts'),
      '@deepseek-ai/dsh-client-runtime/client': dsh('packages/client/runtime/src/client/index.ts'),
      '@deepseek-ai/dsh-client-runtime/src/client/slots.ts': dsh('packages/client/runtime/src/client/slots.ts'),
      '@deepseek-ai/dsh-client-locale/client': dsh('packages/client/locale/src/client/index.ts'),
      '@deepseek-ai/dsh-client-connection/client': dsh('packages/client/connection/src/client/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
