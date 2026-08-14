/**
 * Local host-service fakes for the Fabric test suite.
 *
 * The authoritative DSH services (`tools`, `systemPrompt`, `commands`, the
 * browser command/slot services, and the webserver) are private packages that
 * cannot be installed from the npm registry. The tests exercise the same
 * delegation contract through these repository-local structural fakes: each
 * fake is a Cordis `Service` subclass so registrations are owned by the
 * calling fiber (Cordis shadow contexts), enforce the same duplicate-name
 * failures, and expose the same observable surfaces the real services do.
 * @module tests/fakes
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  HostAgent,
  HostAssembleContext,
  HostCommandContribution,
  HostCommandDefinition,
  HostCommandDescriptor,
  HostCommandRegistry,
  HostClientCommandRegistry,
  HostPromptAssembly,
  HostPromptContext,
  HostPromptSection,
  HostSlotRegistry,
  HostSystemPrompt,
  HostToolDefinition,
  HostToolRegistry,
} from '../src/host-contracts.ts'

/** Fake authoritative tool registry (provides `tools`). */
export class FakeToolRegistryService extends Service implements HostToolRegistry {
  private readonly tools = new Map<string, HostToolDefinition>()

  /** Create and install the fake tool registry. */
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: HostToolDefinition): () => void {
    if (typeof definition.name !== 'string' || typeof definition.description !== 'string') {
      throw new Error(`tool registry: invalid tool definition ${String(definition.name)}`)
    }
    if (this.tools.has(definition.name)) {
      throw new Error(`tool registry: tool "${definition.name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.tools.set(definition.name, definition)
      return () => { this.tools.delete(definition.name) }
    }, `fake-tools.register(${definition.name})`)
    return () => { this.tools.delete(definition.name) }
  }

  schemas(): readonly { readonly name: string }[] {
    return [...this.tools.values()].map(definition => ({ name: definition.name }))
  }
}

const PROMPT_VARIABLE_NAME = /^[a-z][a-z0-9_]*$/u

/** Fake authoritative system-prompt registry (provides `systemPrompt`). */
export class FakeSystemPromptService extends Service implements HostSystemPrompt {
  private readonly sections = new Map<string, HostPromptSection>()
  private readonly contexts = new Map<string, HostPromptContext>()
  private readonly variables = new Map<string, (context: HostAssembleContext) => string | undefined>()

  /** Create and install the fake system-prompt registry. */
  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  private registerName<T extends { readonly name: string }>(
    kind: string,
    entry: T,
    store: Map<string, T>,
  ): () => void {
    if (store.has(entry.name)) {
      throw new Error(`system-prompt: ${kind} "${entry.name}" is already registered`)
    }
    this.ctx.effect(() => {
      store.set(entry.name, entry)
      return () => { store.delete(entry.name) }
    }, `fake-system-prompt.${kind}(${entry.name})`)
    return () => { store.delete(entry.name) }
  }

  section(section: HostPromptSection): () => void {
    return this.registerName('section', section, this.sections)
  }

  context(context: HostPromptContext): () => void {
    return this.registerName('context', context, this.contexts)
  }

  variable(name: string, provider: (context: HostAssembleContext) => string | undefined): () => void {
    if (!PROMPT_VARIABLE_NAME.test(name)) {
      throw new Error(`system-prompt: invalid prompt variable name "${name}"`)
    }
    if (this.variables.has(name)) {
      throw new Error(`system-prompt: variable "${name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.variables.set(name, provider)
      return () => { this.variables.delete(name) }
    }, `fake-system-prompt.variable(${name})`)
    return () => { this.variables.delete(name) }
  }

  tools(): () => void {
    return () => {}
  }

  async assemble(): Promise<HostPromptAssembly> {
    const resolve = (text: string | ((context: HostAssembleContext) => string)): string =>
      typeof text === 'function' ? text({}) : text
    const parts = (
      entries: ReadonlyArray<{
        name: string
        order: number
        text: string | ((context: HostAssembleContext) => string)
      }>,
    ) =>
      [...entries]
        .sort((a, b) => a.order - b.order)
        .map(entry => ({ name: entry.name, text: resolve(entry.text) }))
    return {
      sections: parts([...this.sections.values()]),
      contexts: parts([...this.contexts.values()]),
      variables: Object.fromEntries(
        [...this.variables.entries()].map(([name, provider]) => [name, provider({})]),
      ),
    }
  }
}

/** Fake authoritative command registry (provides `commands`). */
export class FakeCommandRegistryService extends Service implements HostCommandRegistry {
  private readonly commands = new Map<string, HostCommandDefinition>()

  /** Create and install the fake command registry. */
  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: HostCommandDefinition): () => void {
    if (this.commands.has(definition.name)) {
      throw new Error(`command registry: command "${definition.name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.commands.set(definition.name, definition)
      return () => { this.commands.delete(definition.name) }
    }, `fake-commands.register(${definition.name})`)
    return () => { this.commands.delete(definition.name) }
  }

  list(_agent: HostAgent): readonly HostCommandDescriptor[] {
    return [...this.commands.values()]
      .map(definition => ({ name: definition.name, description: definition.description }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** Fake browser command service (provides `command`). */
export class FakeClientCommandRegistryService extends Service implements HostClientCommandRegistry {
  private readonly commands = new Map<string, HostCommandContribution>()

  /** Create and install the fake browser command service. */
  constructor(ctx: Context) {
    super(ctx, 'command')
  }

  register(contribution: HostCommandContribution): () => void {
    if (this.commands.has(contribution.name)) {
      throw new Error(`client-command: contribution "${contribution.name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.commands.set(contribution.name, contribution)
      return () => { this.commands.delete(contribution.name) }
    }, `fake-client-command.register(${contribution.name})`)
    return () => { this.commands.delete(contribution.name) }
  }
}

/** Fake browser slot registry (provides `slots`). */
export class FakeSlotRegistryService extends Service implements HostSlotRegistry {
  private readonly slots = new Map<string, unknown>()

  /** Create and install the fake browser slot registry. */
  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: unknown, component: unknown): () => void {
    const name = (options as { name?: string }).name
    if (name === undefined) throw new Error('slot registry: options.name is required')
    if (this.slots.has(name)) {
      throw new Error(`slot registry: single-hole slot "${name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.slots.set(name, component)
      this.ctx.emit('slots/changed', name)
      return () => { this.slots.delete(name) }
    }, `fake-slots.register(${name})`)
    return () => { this.slots.delete(name) }
  }
}
