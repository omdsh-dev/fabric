/**
 * The catalog adapter belongs to the DSH integration layer: the pure Fabric
 * package has no dependency on the host's tool-cordis catalog.
 * @module @oh-my-dsh/cordis-fabric-dsh/catalog
 */

/** The fabric catalog entries (verbatim from the host patch). */
export const FABRIC_CATALOG_ENTRIES = [
  {
    key: 'fabric',
    summary: 'The Fabric registry service.',
    description: 'The Fabric registry service. Trusted patches register handlers against target module functions at load time; transformed code publishes to a shared bridge the registry dispatches, and disposal restores the original bodies.',
    methods: [
      {
        signature: 'register(patch: FabricPatch): PatchId',
        description: 'Register a patch and enable its handler for the current fiber. The registration is an effect: disposing the fiber disables and removes the patch, so transformed code falls back to the original body. The effect attaches on the first registration of an id only; a later re-registration from another fiber updates metadata and handler without changing disposal ownership.',
        parameters: [{ name: 'patch', description: 'validated patch descriptor.' }],
        returns: 'the registered patch id.',
      },
      {
        signature: 'list(): FabricPatchInfo[]',
        description: 'Ordered diagnostic snapshot of all registered patches.',
        parameters: [],
        returns: 'the patch infos sorted by priority then id.',
      },
      {
        signature: 'disable(id: string): void',
        description: 'Disable a patch\'s handler; transformed code delegates to the original body until the patch is enabled again.',
        parameters: [{ name: 'id', description: 'the patch id.' }],
      },
      {
        signature: 'enable(id: string, handler: FabricHandler): void',
        description: 'Enable a previously disabled patch with a fresh handler binding.',
        parameters: [{ name: 'id', description: 'the patch id.' }, { name: 'handler', description: 'the trusted runtime handler.' }],
      },
      {
        signature: 'bindings(id?: PatchId): readonly FabricBinding[]',
        description: 'Snapshot of load-time bindings: the files the transformation hooks actually rewrote for one patch — the ground truth the `required` check and this package\'s diagnostics are built on.',
        parameters: [{ name: 'id', description: 'the patch id; when omitted, every recorded binding across patches, flattened in patch-id order.' }],
        returns: 'the recorded binding records.',
      },
    ],
  },
  {
    key: 'fabricAgent',
    summary: 'Cooperative Mod-facing Agent lifecycle API.',
    description: 'Cooperative Mod-facing Agent lifecycle API. Listeners observe creation, disposal, and status transitions over the authoritative agent events; logged context injection goes through the Agent\'s own durable injection path.',
    methods: [
      {
        signature: 'onCreated(listener: (agent: Agent) => void): () => boolean',
        description: 'Observe a live agent being created.',
        parameters: [{ name: 'listener', description: 'called with the created agent.' }],
        returns: 'the exact `ctx.on()` disposer removing this listener.',
      },
      {
        signature: 'onDisposed(listener: (agent: Agent) => void): () => boolean',
        description: 'Observe a live agent being disposed.',
        parameters: [{ name: 'listener', description: 'called with the disposed agent.' }],
        returns: 'the exact `ctx.on()` disposer removing this listener.',
      },
      {
        signature: 'onStatus(listener: (agent: Agent, status: AgentStatus) => void): () => boolean',
        description: 'Observe an agent\'s idle/running status transitions.',
        parameters: [{ name: 'listener', description: 'called with the agent and its new status.' }],
        returns: 'the exact `ctx.on()` disposer removing this listener.',
      },
      {
        signature: 'inject(agent: Agent, message: UserMessage): void',
        description: 'Inject a logged, model-visible user message into one agent\'s context. The message goes through `agent.inject()`, the Agent\'s own durable injection path: anything this API contributes to a model request is reconstructable from the session log. No provider request is assembled here.',
        parameters: [{ name: 'agent', description: 'the live agent to inject into.' }, { name: 'message', description: 'the sourced user message to append.' }],
      },
    ],
  },
  {
    key: 'fabricCommands',
    summary: 'Cooperative Mod-facing command registry API.',
    description: 'Cooperative Mod-facing command registry API. Human command registration and effective descriptor listing over the authoritative command registry.',
    methods: [
      {
        signature: 'register(definition: CommandDefinition): () => void',
        description: 'Register one human command through the authoritative registry.',
        parameters: [{ name: 'definition', description: 'discovery metadata and direct UI handler.' }],
        returns: 'the exact effect disposer that unregisters this definition.',
      },
      {
        signature: 'list(agent: Agent): readonly CommandDescriptor[]',
        description: 'List the effective immutable command descriptors for one agent.',
        parameters: [{ name: 'agent', description: 'exact receiving agent and scoped-layer key.' }],
        returns: 'name-sorted descriptors after scoped shadowing.',
      },
    ],
  },
  {
    key: 'fabricPrompt',
    summary: 'Cooperative Mod-facing system-prompt registry API.',
    description: 'Cooperative Mod-facing system-prompt registry API. Ordered system sections, cache-safe context contributions, tool-schema providers, and prompt variables over the authoritative prompt registry.',
    methods: [
      {
        signature: 'section(section: PromptSection): () => void',
        description: 'Register an ordered system section.',
        parameters: [{ name: 'section', description: 'the section to register.' }],
        returns: 'the exact effect disposer that unregisters it.',
      },
      {
        signature: 'context(context: PromptContext): () => void',
        description: 'Register an ordered, cache-safe dynamic context contribution.',
        parameters: [{ name: 'context', description: 'the context contribution to register.' }],
        returns: 'the exact effect disposer that unregisters it.',
      },
      {
        signature: 'tools(provider: (context: AssembleContext) => ToolProviderResult): () => void',
        description: 'Register a tool-schema provider.',
        parameters: [{ name: 'provider', description: 'evaluated for each assembly with its context.' }],
        returns: 'the exact effect disposer that unregisters it.',
      },
      {
        signature: 'variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void',
        description: 'Register a prompt variable.',
        parameters: [{ name: 'name', description: 'the `[a-z][a-z0-9_]*` reference name.' }, { name: 'provider', description: 'evaluated for each assembly; returning `undefined` makes a referencing section fail.' }],
        returns: 'the exact effect disposer that unregisters it.',
      },
    ],
  },
  {
    key: 'fabricTools',
    summary: 'Cooperative Mod-facing tool registry API.',
    description: 'Cooperative Mod-facing tool registry API. Tool registration and pre/post-execute waterfall listeners over the authoritative tool registry.',
    methods: [
      {
        signature: 'register(definition: ToolDefinition): () => void',
        description: 'Register one tool through the authoritative registry.',
        parameters: [{ name: 'definition', description: 'tool schema, execution, and optional finalization/presentation callbacks.' }],
        returns: 'the exact disposer that unregisters the tool.',
      },
      {
        signature: 'onPreExecute(listener: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>): () => boolean',
        description: 'Observe or gate dispatch through `tools/pre-execute`.',
        parameters: [{ name: 'listener', description: 'the waterfall listener; call `next()` to delegate, return without it to veto.' }],
        returns: 'the exact `ctx.on()` disposer removing this listener.',
      },
      {
        signature: 'onPostExecute( listener: ( exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>, ) => Promise<PostToolDecision>, ): () => boolean',
        description: 'Observe or shape a normalized dispatch outcome through `tools/post-execute`.',
        parameters: [{ name: 'listener', description: 'the waterfall listener; call `next()` to accept the result unchanged.' }],
        returns: 'the exact `ctx.on()` disposer removing this listener.',
      },
    ],
  },
  {
    name: 'FabricAfterHandler',
    declaration: 'export type FabricAfterHandler = (call: FabricCall) => unknown;',
  },
  {
    name: 'FabricAroundHandler',
    declaration: 'export type FabricAroundHandler = (call: FabricCall, invoke: FabricInvoke) => unknown;',
  },
  {
    name: 'FabricBeforeHandler',
    declaration: 'export type FabricBeforeHandler = (call: FabricCall) => void;',
  },
  {
    name: 'FabricBinding',
    declaration: 'export interface FabricBinding {\n    module: string;\n    file: string;\n    nodes: number;\n}',
  },
  {
    name: 'FabricCall',
    declaration: 'export interface FabricCall {\n    arguments: unknown[];\n    self: unknown;\n    moduleVersion?: string;\n    result?: unknown;\n}',
  },
  {
    name: 'FabricHandler',
    declaration: 'export type FabricHandler = FabricBeforeHandler | FabricAfterHandler | FabricAroundHandler | FabricReplaceHandler;',
  },
  {
    name: 'FabricInvoke',
    declaration: 'export type FabricInvoke = () => unknown;',
  },
  {
    name: 'FabricOperation',
    declaration: 'export type FabricOperation = \'before\' | \'after\' | \'around\' | \'replace\';',
  },
  {
    name: 'FabricPatch',
    declaration: 'export interface FabricPatch {\n    id: PatchId;\n    target: FabricTarget;\n    operation: FabricOperation;\n    required?: boolean;\n    priority?: number;\n    handler: FabricHandler;\n}',
  },
  {
    name: 'FabricPatchInfo',
    declaration: 'export interface FabricPatchInfo {\n    id: PatchId;\n    target: FabricTarget;\n    operation: FabricOperation;\n    priority: number;\n    enabled: boolean;\n    bindings?: readonly FabricBinding[];\n}',
  },
  {
    name: 'FabricReplaceHandler',
    declaration: 'export type FabricReplaceHandler = (call: FabricCall, invoke: FabricInvoke) => unknown;',
  },
  {
    name: 'FabricTarget',
    declaration: 'export interface FabricTarget {\n    module: string;\n    versionRange: string;\n    filePath?: string | RegExp;\n    filePaths?: string[];\n    functionQuery?: FunctionQuery;\n    astQuery?: string;\n    index?: number | null;\n}',
  },
  {
    name: 'PatchId',
    declaration: 'export type PatchId = string;',
  },
  {
    name: 'PreToolDecision',
    declaration: 'export type PreToolDecision = {\n    kind: \'allow\';\n} | {\n    kind: \'deny\';\n    reason: string;\n} | {\n    kind: \'ask\';\n    reason?: string;\n};',
  },
]

/** Push the fabric entries into the official catalog once (idempotent). */
export async function registerCatalogEntries(): Promise<void> {
  try {
    // Variable specifier: the official package is host-provided only, never
    // a trio dependency, so the import stays out of the type graph.
    const spec = '@deepseek-ai/dsh-tool-cordis/src/api-catalog.ts'
    const catalog = await import(spec)
    const list = catalog.SERVICE_API as unknown as Array<{ key: string }>
    for (const entry of FABRIC_CATALOG_ENTRIES as Array<{ key: string }>) {
      if (!list.some(existing => existing.key === entry.key)) list.push(entry as never)
    }
  } catch {
    // Built host (no tsx, no ./src/* resolution): the inspect report still
    // lists the live fabric services, just without signatures.
  }
}
