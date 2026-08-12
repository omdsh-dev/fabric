/**
 * Narrow host contracts for `cordis-fabric-dsh`.
 *
 * This module is the package's only view of the DSH host runtime. Every
 * `@deepseek-ai/*` package consumed by Fabric is private and not installable
 * from the npm registry, so this repository cannot import their declarations.
 * Instead it declares the smallest structural surface Fabric actually uses:
 * the facade services delegate to the authoritative host services at runtime,
 * and the host (a composed DSH profile) supplies objects that satisfy these
 * shapes. The contracts are deliberately narrow: they expose only what the
 * facades forward, never host internals, and they must stay in sync with the
 * documented delegation in each facade module.
 * @module cordis-fabric-dsh/host-contracts
 */

import type { Context } from 'cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Status values the host agent service mirrors on `agent/status`. */
export type HostAgentStatus = 'idle' | 'running'

/** Live host agent surface the Fabric API observes and injects into. */
export interface HostAgent {
  /** The single identity shared with the host session. */
  readonly id: unknown
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: HostAgentStatus
  /** Route identified, model-visible input through the agent's durable injection path. */
  inject(message: HostUserMessage): void
}

/** Identified user message accepted by the host injection path. */
export interface HostUserMessage {
  /** Stable message identity assigned by the host. */
  readonly id: unknown
  /** Model-visible content blocks owned by the host message vocabulary. */
  readonly content: unknown
}

/** Invocation record handed to a registered command handler. */
export interface HostCommandInvocation {
  /** Pairing id carried by this execution's lifecycle events. */
  readonly commandId: unknown
  /** Exact text following the command name. */
  readonly rawInput: string
}

/** Result a command handler returns to the host registry. */
export type HostCommandResult = {
  /** Normalized outcome kind owned by the host command vocabulary. */
  readonly kind: string
  /** Optional human-readable outcome text. */
  readonly text?: string
}

/** Plugin-owned command registration forwarded to the host command registry. */
export interface HostCommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: unknown
  /** Whether the host records the raw input; defaults to true. */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: HostCommandInvocation) => HostCommandResult | Promise<HostCommandResult>
}

/** Handler-free immutable command view returned by the host registry. */
export interface HostCommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: unknown
}

/** Pre-dispatch decision returned through the `tools/pre-execute` waterfall. */
export type HostPreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/** Post-dispatch decision returned through the `tools/post-execute` waterfall. */
export type HostPostToolDecision =
  | { kind: 'accept'; content?: unknown[]; value?: unknown; additionalContexts?: unknown[] }
  | { kind: 'block'; feedback: unknown[]; additionalContexts?: unknown[] }

/** One in-flight tool call view forwarded to `tools/*` event listeners. */
export interface HostToolExecution {
  /** Root model-requested call owning this execution tree. */
  readonly rootCallId?: unknown
  /** The tool's canonical name. */
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments. */
  readonly arguments: unknown
  /** Caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}

/** The discriminated, execution-local outcome of one tool call. */
export type HostToolExecutionResult = {
  /** Whether the execution failed. */
  readonly isError: boolean
  /** Canonical lossless-JSON value, present only on success. */
  readonly value?: unknown
  /** Normalized failure, present only on failure. */
  readonly error?: unknown
  /** Model-facing content projection. */
  readonly content?: unknown[]
}

/** A registered tool definition forwarded to the host tool registry. */
export interface HostToolDefinition {
  /** The tool's canonical name. */
  readonly name: string
  /** Human-readable description shown to the model. */
  readonly description: string
  /** JSON schema of the accepted arguments. */
  readonly schema?: unknown
  /** Run one accepted call and return its canonical lossless-JSON value. */
  readonly execute?: (args: unknown, exec: { readonly signal: AbortSignal }) => Promise<unknown>
}

/** Host tool registry the Fabric Tool API delegates to. */
export interface HostToolRegistry {
  /** Register one tool; the returned disposer unregisters it. */
  register(definition: HostToolDefinition): () => void
  /** The currently registered tool schemas, model-visible projection included. */
  schemas(): readonly { readonly name: string }[]
}

/** Merge-extensible context for one prompt assembly. */
export interface HostAssembleContext {
  /** Explicit control signal for the turn that requested this assembly, when any. */
  readonly signal?: AbortSignal
}

/** One contributed section of the system prompt (registry input). */
export interface HostPromptSection {
  /** Unique name; a duplicate registration fails loud. */
  readonly name: string
  /** Sections are concatenated in ascending order. */
  readonly order: number
  /** Static text or a provider evaluated at each assembly. */
  readonly text: string | ((context: HostAssembleContext) => string)
  /** Treat this contribution as the complete system prompt. */
  readonly complete?: boolean
}

/** Dynamic model context materialized as a durable user-role snapshot. */
export interface HostPromptContext {
  /** Unique name; a duplicate registration fails loud. */
  readonly name: string
  /** Contexts are joined in ascending order. */
  readonly order: number
  /** Static text or a provider evaluated at each assembly. */
  readonly text: string | ((context: HostAssembleContext) => string)
}

/** Tool schemas visible in one assembly and their pre-restriction name set. */
export interface HostToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly unknown[]
  /** The pre-restriction name universe for config validation. */
  readonly knownNames?: readonly string[]
}

/** One resolved assembly section or context. */
export interface HostAssembledPart {
  /** The contributing part's unique name. */
  readonly name: string
  /** The resolved text before variable interpolation. */
  readonly text: string
}

/** The resolved system-prompt assembly. */
export interface HostPromptAssembly {
  /** Resolved sections in order. */
  readonly sections: readonly HostAssembledPart[]
  /** Resolved contexts in order. */
  readonly contexts: readonly HostAssembledPart[]
  /** Resolved variables by name. */
  readonly variables: Readonly<Record<string, string | undefined>>
}

/** Host system-prompt registry the Fabric Prompt API delegates to. */
export interface HostSystemPrompt {
  /** Register an ordered system section. */
  section(section: HostPromptSection): () => void
  /** Register an ordered, cache-safe dynamic context contribution. */
  context(context: HostPromptContext): () => void
  /** Register a tool-schema provider. */
  tools(provider: (context: HostAssembleContext) => HostToolProviderResult): () => void
  /** Register a prompt variable. */
  variable(name: string, provider: (context: HostAssembleContext) => string | undefined): () => void
  /** Resolve the complete assembly for one turn. */
  assemble(): Promise<HostPromptAssembly>
}

/** Host command registry the Fabric Command API delegates to. */
export interface HostCommandRegistry {
  /** Register one human command; the returned disposer unregisters it. */
  register(definition: HostCommandDefinition): () => void
  /** List the effective immutable command descriptors for one agent. */
  list(agent: HostAgent): readonly HostCommandDescriptor[]
}

/** Client command contribution forwarded to the browser command service. */
export interface HostCommandContribution {
  /** Command name without the leading slash (unique across contributions). */
  readonly name: string
  /** Menu row description. */
  readonly description: string
  /** Capability filter, called with a fresh projection per candidate pass. */
  available(session: unknown): boolean
  /** The command's UI behavior, owned by the browser command contract. */
  readonly ui: unknown
}

/** Browser command service the Fabric Client API delegates to. */
export interface HostClientCommandRegistry {
  /** Register one client command contribution; the returned disposer unregisters it. */
  register(contribution: HostCommandContribution): () => void
}

/** Browser slot registry the Fabric Client API delegates to. */
export interface HostSlotRegistry {
  /** Register one slot contribution; the returned disposer unregisters it. */
  register(options: unknown, component: unknown): () => void
}

/** One webserver route the serve primitive or the host registers. */
export interface HostHttpRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void
}

/** Host webserver the serve primitive registers exact routes on. */
export interface HostHttpServer {
  /** The bound listener port. */
  readonly port: number
  /** Register one route; the returned disposer removes it. */
  register(route: HostHttpRoute): () => void
}

/** Package-attributed invariant failure reported by the host registry. */
export type HostInvariantFailure = (message: string) => never

/** Installer callback accepted by the host's invariant registry. */
export type HostInvariantInstaller = (ctx: Context, fail: HostInvariantFailure) => void | Promise<void>

/** Minimal runtime contract used by the invariant companions without a host checkout. */
export interface HostInvariantRegistry {
  register(packageName: string, installer: HostInvariantInstaller): () => void
}

declare module 'cordis' {
  interface Context {
    /** The authoritative tool registry the Fabric Tool API delegates to. */
    tools: HostToolRegistry
    /** The authoritative system-prompt registry the Fabric Prompt API delegates to. */
    systemPrompt: HostSystemPrompt
    /** The authoritative command registry the Fabric Command API delegates to. */
    commands: HostCommandRegistry
    /** The browser command service the Fabric Client API delegates to. */
    command: HostClientCommandRegistry
    /** The browser slot service the Fabric Client API delegates to. */
    slots: HostSlotRegistry
    /** The host webserver the serve primitive registers routes on. */
    httpServer: HostHttpServer
  }

  interface Events {
    /** A live agent was created. */
    'agent/created'(this: Context, payload: { agent: HostAgent }): void
    /** A live agent was disposed. */
    'agent/disposed'(this: Context, payload: { agent: HostAgent }): void
    /** An agent's idle/running status transitioned. */
    'agent/status'(this: Context, payload: { agent: HostAgent; status: HostAgentStatus }): void
    /** Waterfall around tool dispatch; call `next()` to delegate. */
    'tools/pre-execute'(
      this: Context,
      exec: HostToolExecution,
      next: () => Promise<HostPreToolDecision>,
    ): Promise<HostPreToolDecision>
    /** Waterfall around a normalized dispatch outcome; call `next()` to accept. */
    'tools/post-execute'(
      this: Context,
      exec: HostToolExecution,
      result: Readonly<HostToolExecutionResult>,
      next: () => Promise<HostPostToolDecision>,
    ): Promise<HostPostToolDecision>
    /** A browser slot registry emitted a change for one slot name. */
    'slots/changed'(this: Context, name: string): void
  }
}
