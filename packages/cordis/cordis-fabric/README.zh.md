# `@deepseek-ai/dsh-cordis-fabric`

[English](README.md) | 中文

基于 [Orchestrion-JS](https://github.com/nodejs/orchestrion-js) 的Fabric/Mixin 风格扩展层，服务于受信任的 Cordis 插件。service 是 opt-in：默认 DSH composition 不会挂载它，patch 通过受信任代码注册。

## 它能做什么

受信任的插件 A 可以**在不修改 B 源码**的情况下，通过针对 B 的模块、文件和函数注册 Fabric patch，改变 B 的某个函数的行为：

| 操作 | Handler 可以做什么 |
|---|---|
| `before` | 在原函数体执行前改写调用参数。 |
| `after` | 观察或替换成功结果（包括异步结果在 settlement 之后）。 |
| `around` | 决定原函数体是否执行，并可替换其结果（调用 `invoke()` 委托）。 |
| `replace` | 完全接管调用；只有 handler 调用 `invoke()` 时才执行原函数体。 |

机制是加载期代码变换：transform hook 把目标函数体重写为向进程内 bridge channel 发布调用记录，runtime 将其分发给当前注册的 handler。没有活跃 handler（禁用、销毁或从未启用）时，变换后的代码原样委托给原函数体。

## 安装和 bootstrap

```ts ignore-check
import { bootstrapFabric, FabricService } from '@deepseek-ai/dsh-cordis-fabric'

// 1. Before any target module is imported (application preparation):
const disposeHooks = bootstrapFabric([patch])

// 2. Mount the service so plugins can register handlers:
await ctx.plugin(FabricService)
```

`bootstrapFabric` 校验 patches、构建它们的 Orchestrion instrumentation 并安装变换 hooks。在 `dsh` 宿主中，带 `config.patches`（静态描述——handler 是注册时绑定的受信任代码）的 `cordis-fabric` composition 行会在 `boot()` 准备阶段自动 bootstrap，早于任何 config-tree entry 挂载；当 instrumentation 已经构建好时，`installFabricHooks` 是更底层的形态。

```yaml
# User overlay (e.g. $DSH_HOME/config.yaml or a --config file): enable the row
# and declare the static patch descriptors. Handlers are NOT configured here —
# plugins register them through ctx.fabric at runtime.
- id: cordis-fabric
  disabled: false
  config:
    patches:
      - id: vendor/rewrite-greeting
        target:
          module: '@example/target-package'
          versionRange: '^1.0.0'
          filePath: 'lib/index.js'
          functionQuery: { functionName: 'greet', kind: 'Sync' }
        operation: 'before'
```

同一行的浏览器 half（`./client`）在该行启用时于 web 树中挂载 `ctx.fabric`；client bundle 在构建期变换，只有在该 entry 物化后才生效。

hooks 必须在目标模块首次求值前安装；之后注册的 patch 只对后续才被变换的模块生效。`registerHooks` API 没有 unregister，因此返回的 disposer 只是停用该安装的状态，而不是移除 hook 函数本身。


## 注册 patch

```ts ignore-check
export const inject = ['fabric']

export function apply(ctx: Context): void {
  ctx.fabric.register({
    id: 'my-vendor/rewrite-greeting',
    target: {
      module: '@example/target-package',
      versionRange: '^1.0.0',
      filePath: 'lib/index.js',
      functionQuery: { functionName: 'greet', kind: 'Sync' },
    },
    operation: 'before',
    handler(call: { arguments: unknown[] }) {
      call.arguments[0] = String(call.arguments[0]).toUpperCase()
    },
  })
}
```

注册是 fiber effect：销毁插件会禁用并移除 patch。`ctx.fabric.list()` 返回有序诊断快照；`ctx.fabric.disable(id)` / `ctx.fabric.enable(id, handler)` 可切换 patch 而不移除它。

## 安全与信任模型

- Patch handler 是在注册时绑定的受信任代码；可执行 handler 绝不从 YAML 或模型输入反序列化。
- 变换后的代码在目标模块内拥有进程级权限。`cordis_mount` 临时插件和 repository 插件在获得显式授权前不得使用 Fabric 能力。
- id 必须匹配 `[A-Za-z0-9._:/+-]{1,120}`（会嵌入诊断信息和生成的代码）。
- 目标校验是失败即显式的：畸形目标（错误的 id、module、version range、file、operation 或 selector）在注册时抛出，而不是安装一个永不匹配的配置。格式正确但匹配不到任何内容的目标——安装版本不同、文件布局不同——会让模块保持未变换（静默）；matcher 只改写其 selector 选中的内容。

## 平台支持

- **Node Host（ESM + CommonJS）：** 通过同步 `module.registerHooks`（Node ≥ 22.22.3 / ≥ 24.11.1）和 CJS `_compile` 路径支持。没有 `registerHooks` 的 Node 版本通过 `./hook-entry` loader-thread 模块走异步 `module.register` fallback。
- **Browser/Web：** bundle 期重写（`createBrowserTransform` + `repoSourceResolver`，经 `clientBundle(id, libEntry, { transform })` 接入）重写 client 插件函数；本 package 的 client half（`./client`）在浏览器 Cordis 树中安装 bridge 并挂载 `ctx.fabric`。client bundle 在该 entry 物化前回退到原函数，因此 patch 对浏览器 Fabric runtime 就绪后的调用生效。web roster 的 `cordis-fabric` 行默认禁用（opt-in）。

## Browser 构建用法

```ts ignore-check
import { createBrowserTransform, repoSourceResolver, patchInstrumentation } from '@deepseek-ai/dsh-cordis-fabric'
import { clientBundle } from '../tsdown.client.js'

const fabric = createBrowserTransform(
  [patchInstrumentation(patch)],
  repoSourceResolver('@deepseek-ai/dsh-client-my-plugin', new URL('..', import.meta.url).pathname, '0.0.1'),
)

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'], {
  transform: (code, id) => fabric(code, id) ?? undefined,
})
```

resolver 把包自身的源码树映射到包身份；不使用上游 adapter，因为它要求 `node_modules` 边界，而仓库源码构建没有该边界。TypeScript 源码会在变换前剥离类型注解（transformer 解析编译后的 JavaScript）。

## Model Experience

None, as this package is host-side load-time transformation and patch registry machinery; patches register through code, never through model-written configuration.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## 已知限制和待办

- **Hooks 留存到进程结束，state 不会。** `registerHooks` hooks 会组合并留存；disposer 移除该安装的 state（hooks 变为透传，缓存 transformer 被释放）。每次安装捕获自己的 state 并通过自己的 matcher 变换，因此并发安装彼此隔离；共享的 CommonJS `_compile` wrapper 始终查栈顶安装，先安装被 dispose 后，后安装不受影响。
- **CommonJS 模块可重新变换；ESM 模块不能。** 已经求值的 CommonJS 模块可以通过 `retransformCommonJs(filename)` 在当前安装栈下重新求值：其 `require.cache` 条目和 seen 标记会被清除，下一次 `require()` 会再次运行 `_compile` wrapper。HMR 周期通过先 dispose 旧安装（其 hooks 变为透传）再重新求值来替换补丁，因此新模块只携带新 instrumentation；旧导出对象保持旧变换。ESM 模块没有对应机制——ESM cache 没有 unload 路径——因此禁用 patch 会让已变换的 ESM 代码委托回原函数体，但模块不会被重新变换。
- **同一函数上的多个 patch 按 priority 叠加**：instrumentation 按升序应用，高 priority 的 handler 先执行（最外层）；相等 priority 保持安装序（后安装的 instrumentation 包裹最外层，因此其 handler 先运行）。同一目标上的两个 `replace` patch 在注册时被拒绝。
- **箭头目标仅支持简单 Identifier 参数**（不支持 rest、默认值或解构），且函数体读取外层 `arguments` 对象的箭头会被跳过（traced 函数会遮蔽它）；其他箭头被跳过。generator 函数目标被跳过（注入的 return 会破坏迭代语义）。
- **Node 加载期变换要求预编译 JavaScript。** loader 解析编译后的 JS；把原始 `.ts` 源码交给 Node load hook 会失败即显式。浏览器构建路径会在变换前剥离 TypeScript 注解（含 JSX）。
