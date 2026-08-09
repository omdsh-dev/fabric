# `@deepseek-ai/dsh-cordis-fabric-api`

[English](README.md) | 中文

协作式 Fabric API 模块：稳定、面向 Mod 的 Cordis 扩展契约，委托给 DSH 权威 service。该 package 是 DSH 对 Minecraft Fabric API 的对应物——位于 loader 与 Mixin 子系统之上的一层可选库——且是 opt-in：默认 DSH composition 不挂载它。

## 它做什么

Fabric 风格扩展架构由三层组成。前两层已存在；本 package 是第三层：

| 层 | 所有者 | 契约 |
|---|---|---|
| Mod loader | Cordis Loader | 发现配置中的插件、解析注入、挂载 fiber 并销毁 effect。 |
| Mixin 子系统 | [`@deepseek-ai/dsh-cordis-fabric`](../cordis-fabric/README.md) | 变换目标代码并分发受信任的底层 patch。 |
| 协作式 Mod API | 本 package | 由现有 DSH 所有者支撑的稳定 domain-level registration 和 event。 |

Mod 仍然是普通 Cordis 插件，只声明它所消费的 Fabric API 模块 service 的注入。每个 facade 委托给权威 service——`ctx.tools`、`ctx.systemPrompt`、`ctx.commands`、`agent/*` 事件以及浏览器侧的 `ctx.command`/`ctx.slots`——并返回底层 effect 的精确 disposer。Facade 不保存 domain state 的平行副本，也不能绕过 policy、approval、timeout、日志、取消或权威 executor。

## 模块

| Entry | Service | 平台 | 委托给 |
|---|---|---|---|
| `.`（Host bundle） | 挂载全部四个 Host 模块 | Host | 下方四个 entry |
| `./agent` | `ctx.fabricAgent` | Host | `agent/*` 事件和 `agent.inject()` |
| `./tools` | `ctx.fabricTools` | Host | `ctx.tools` 和 `tools/*` |
| `./prompt` | `ctx.fabricPrompt` | Host | `ctx.systemPrompt` |
| `./commands` | `ctx.fabricCommands` | Host | `ctx.commands` |
| `./compat` | `ctx.fabricCompat` | Host | 低层 `dsh-cordis-fabric` patch（缺口 adapter） |
| `./client` | `ctx.fabricClient` | Web | `ctx.command` 和 `ctx.slots` |

root entry 是标准 Host bundle；每个 subpath 也可以单独挂载，适合精简 composition。浏览器 entry 是 `dshClient` artifact，带有默认禁用的 web roster 行（opt-in）。

## 安装

在权威 service 存在的位置挂载 Host bundle（或某个 subpath）：

```ts ignore-check
import * as fabricApi from '@deepseek-ai/dsh-cordis-fabric-api'

// mounts ctx.fabricAgent, ctx.fabricTools, ctx.fabricPrompt, ctx.fabricCommands
await ctx.plugin(fabricApi)
```

```yaml
# User overlay: enable the Host bundle row.
- id: cordis-fabric-api
  disabled: false
```

Mod 只声明它消费的模块：

```ts ignore-check
export const name = 'my-mod'
export const inject = ['fabricAgent', 'fabricPrompt']

export function apply(ctx: Context): void {
  ctx.fabricAgent.onStatus((agent, status) => {
    ctx.logger.info('agent %s is %s', agent.id, status)
  })
  ctx.fabricPrompt.section({
    name: 'my-mod-identity',
    order: -80,
    text: 'my-mod is active',
  })
}
```

## 契约

每个 registration 都是 fiber effect：销毁贡献插件会移除贡献，与权威所有者的 disposal 语义一致（HMR-safe）。Facade 方法返回底层精确 disposer。

- **Agent API。** 生命周期观察（`onCreated`、`onDisposed`、`onStatus`）和操作局部 context injection（`inject`）的稳定子集。它不暴露具体 loop、私有队列状态或可变 session 内部；只有当权威事件本来就提供 live Agent 时，callback 才接收它。
- **Tool API。** 通过 `ctx.tools` 注册 tool 以及执行前后 listener。Fabric API tool 与原生 DSH tool 具有相同的 schema 和 result 义务，包括 model-visible logging 和 render intent。Waterfall listener 必须调用 `next()`，除非它有意否决。
- **Prompt API。** 通过 `ctx.systemPrompt` 注册有序 system section、可安全缓存的 context、tool-schema provider 和 prompt variable。没有插入未记录 model-visible 文本或直接组装 provider request 的捷径。
- **Command API。** 通过 `ctx.commands` 注册人类用户 command；除非权威契约启动 turn，否则 command 保持在 model turn 之外。
- **Compat API。** 低层补丁机制的协作式入口。两个面：`observe(name, listener)` 保留静态观察适配器（面向没有协作式扩展点的目标 domain；目标在模块 config 中声明，`buildCompatInstrumentations` 生成加载期 instrumentations，对外契约只暴露声明的目标名）。`registerPatch(patch)` / `unregisterPatch` / `disablePatch` / `enablePatch` 打开完整的运行时补丁面——handler 在运行时绑定到 launcher bootstrap 已安装的变换（web roster 的 `config.fabric.patches` 桩）——并带**排他的 id 命名空间**：已被声明的观察目标或更早的注册占用的 id 会失败即显式（低层注册表是静默更新）。`serveBundle(options)` 暴露运行时浏览器 bundle 原语（`serveBrowserTransform`），bundle 重写也经协作式门面进入。所有面都校验 bridge installation capability（`isFabricInstalled`），hooks 缺失时失败即显式。
- **Client API。** 通过 `ctx.command` 和 `ctx.slots` 注册 client command 和命名 UI slot。Slot registration face 刻意保持窄（`FabricSlotOptions`）：完整的 SlotMap 类型机制位于 `@deepseek-ai/dsh-client-ui-slots`，其声明合并只能看到每个 consumer 导入的包。`registerKeyedSlot(name, key, options, component)` 为 keyed 槽位增加**仲裁**：宿主不变式（每 key 一个属主、重复 loud）保持不变，但属主由声明的 `priority` 决定而非挂载时序——败者排队并在属主销毁时自动接管（`onGain`），更高优先级认领者接替在位者而不强制卸载它（`onLost` 通知它），同优先级保持注册序并告警。直接 `ctx.slots.register` 的用户仍得到宿主抛错。

Public surface 不导出 AST selector、模块文件路径、`FabricPatch`、raw bridge handle，也不提供绕过 tool/command/prompt policy 的路径。底层 patch 仍然是 Mixin 子系统的 escape hatch，绝不是本 package 契约的一部分。

## 安全与信任模型

- Fabric API 可以比 `ctx.fabric` 更广泛地授予，但不会自动提供给模型写入的临时插件：每个 facade 通过所属 service 触达真实进程能力，repository/temporary-plugin policy 显式授予模块。
- 缺失的必需模块 service 在 Cordis activation 期间失败（声明的 `inject`），可选能力用 `ctx.get()` 读取。
- Facade 不会扩大其委托 service 的权限。

## 平台支持

- **Node Host：** 全部五个 Host 模块，通过权威 Host service（compat adapter 额外要求 Fabric 加载期 hooks）。
- **Browser/Web：** `./client` entry 在浏览器 Cordis 树中挂载 `ctx.fabricClient`；web roster 行 `cordis-fabric-api` 默认禁用（opt-in）。

## Model Experience

本身没有。通过本 package 注册的 tool 和 prompt section 以所属 registry 使其 model-visible 的完全相同方式 model-visible，session log 可重建到达 model request 的一切。

#### KV Cache effect

无；package 既不组装也不发送 provider request。

## Known Limitations and Deferred Work

- **Facade 是经过策划的子集，不是完整镜像。** 只有真实 Mod consumer 需要 domain service 本身没有承诺的兼容边界时，模块才进入 Fabric API；其余一切以 domain service 为权威面。
- **Client slot face 是窄子集。** `ctx.fabricClient.registerSlot` 接受稳定的 option 形状（`FabricSlotOptions`）；声明合并和 composed-props 推断保留在 `dsh-client-ui-slots`，需要完整类型化 register 契约的 Mod 直接使用该 service。
- **Cordis service catalog 不收录模块 service。** Catalog projector 只记录位于 `src/index.ts` 或 `src/service.ts` 的 service 类；每个 Fabric API 模块位于自己的 entry 文件，因此 `ctx.fabricAgent` 等在此文档记录，而不是在生成的 catalog 中。
