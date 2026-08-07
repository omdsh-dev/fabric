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
- 目标校验是失败即显式的：畸形目标（错误的 id、module、version range、file、operation、selector 或 index）在注册时抛出，而不是安装一个永不匹配的配置。格式正确但匹配不到任何内容的目标——安装版本不同、文件布局不同——会让模块保持未变换（静默）；matcher 只改写其 selector 选中的内容。
- selector 在一个文件中选中多个函数时默认改写全部匹配（翻转了上游"只改第一个"的默认值：`index: null`）；传入从零开始的 `index`（原始 `astQuery` 用 `target.index`，名称查询用 `functionQuery.index`）则只改写单个匹配。constructor 目标在变换期显式拒绝——移动的 constructor 体无法携带 `super()` 或 `new.target`——请改为 patch 方法或工厂函数。

## 平台支持

- **Node Host（ESM + CommonJS）：** 通过同步 `module.registerHooks`（Node ≥ 22.22.3 / ≥ 24.11.1）和 CJS `_compile` 路径支持。`registerHooks` 从 22.19.0 起就存在，但在 22.22.3 / 24.11.1 之前，当 loader-thread hooks（`module.register`，例如这些版本上的 tsx）同时存在时，其同步 load 链对 CommonJS 模块不返回 source，会导致 Node 的 load 校验崩溃；因此这些版本通过 `./hook-entry` loader-thread 模块走异步 `module.register` fallback。entry 只注册一次，并在每次加载时读取共享配置文件（主线程在每次安装与销毁时重写），因此重新变换、销毁与并发安装在两条路径上行为一致。
- **Browser/Web：** bundle 期重写（`createWatchedBrowserTransform`（静态集合用 `createBrowserTransform`）+ `repoSourceResolver`，经 `clientBundle(id, libEntry, { transform })` 接入）重写 client 插件函数；本 package 的 client half（`./client`）在浏览器 Cordis 树中安装 bridge 并挂载 `ctx.fabric`。client bundle 在该 entry 物化前回退到原函数，因此 patch 对浏览器 Fabric runtime 就绪后的调用生效。web roster 的 `cordis-fabric` 行默认禁用（opt-in）。

## Browser 构建用法

```ts ignore-check
import { createWatchedBrowserTransform, repoSourceResolver } from '@deepseek-ai/dsh-cordis-fabric'
import { clientBundle } from '../tsdown.client.js'

const fabric = createWatchedBrowserTransform(
  new URL('./fabric.patches.json', import.meta.url).pathname,
  repoSourceResolver('@deepseek-ai/dsh-client-my-plugin', new URL('..', import.meta.url).pathname, '0.0.1'),
)

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'], {
  transform: fabric,
})
```

patches 文件是一个静态 patch stub 的 JSON 数组（与 launcher 的 `config.patches` 行同形；JSON 无法表达 `RegExp` `filePath`，因此文件路径是字符串），文件畸形会在构建期失败即显式。变换在每个模块上把该文件注册进打包器的 watch 图，因此在 `tsdown --watch`（`pnpm run dev:web`）下编辑它会用新 patch 集合重建 bundle——这就是构建触发器——重建产物经 client-hmr 链（stat 轮询、`rebuilt` 帧、invalidate/prefetch/换纤）送达浏览器。静态内存 patch 集合仍可直接使用 `createBrowserTransform`。

resolver 把包自身的源码树映射到包身份；不使用上游 adapter，因为它要求 `node_modules` 边界，而仓库源码构建没有该边界。TypeScript 源码会在变换前剥离类型注解（transformer 解析编译后的 JavaScript）。

## Model Experience

None, as this package is host-side load-time transformation and patch registry machinery; patches register through code, never through model-written configuration.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## 已知限制和待办

- **Hooks 留存到进程结束，state 不会。** `registerHooks` hooks 会组合并留存；disposer 移除该安装的 state（hooks 变为透传，缓存 transformer 被释放）。每次安装捕获自己的 state 并通过自己的 matcher 变换，因此并发安装彼此隔离；共享的 CommonJS `_compile` wrapper 按安装序链式经过每个活跃安装（与同步 hook 链一致），先安装被 dispose 后，后安装不受影响。异步 `module.register` fallback 通过共享配置文件达到相同语义：唯一的 loader-thread entry 在每次加载时读取当前安装栈，因此被 dispose 的安装在下次求值时停止变换 ESM。按 pid 命名的配置文件在进程退出时删除。
- **CommonJS 与 ESM 模块在两条 hook 路径上均可重新变换。** 已经求值的模块可以在当前安装栈下重新求值：`retransformCommonJs(filename)` 清除 `require.cache` 条目（以及同一文件在 Node 内部 `loadCache` 中的条目，使两个图都观察到新的求值）和 seen 标记，`retransformEsm(url)` 驱逐模块在 Node 内部 `loadCache` 中的条目（与 vendored Loader 的 HMR 使用同一机制）——下一次 `require()`/`import()` 会以当前安装栈重新运行 hooks（同步 hooks 读取主线程栈；async entry 读取共享配置）。HMR 周期通过先 dispose 旧安装再重新求值来替换补丁，因此新模块只携带新 instrumentation；旧导出对象保持旧变换。ESM 重新 import 失败时会恢复被驱逐的条目，让之前的实例幸存，而不是让该 URL 无法求值。ESM 重变换要求 Node ≥ 22（内部模块 loader）；async `module.register` fallback 同样支持，因为 loader 线程在重新 import 时会重新读取配置。
- **同一函数上的多个 patch 按 priority 叠加**：instrumentation 按升序应用，高 priority 的 handler 先执行（最外层）；相等 priority 保持安装序（后安装的 instrumentation 包裹最外层，因此其 handler 先运行）。跨安装时，每条 hook 路径上嵌套都按安装序——后安装的包裹最外层，与 priority 无关——因为同步 hooks、CJS `_compile` wrapper 与异步 loader-thread entry 都按安装逐个链式变换。同一目标上的两个 `replace` patch 在注册时被拒绝。
- **箭头目标支持所有参数 pattern**（标识符、rest、默认值和解构——pattern 会在注入语句执行前绑定名字），读取外层 `arguments` 对象的函数体通过先捕获来保留。参数字面命名为 `arguments`（会遮蔽该捕获）的箭头会被跳过。generator 函数通过委托变换：traced generator 在无 handler 与 `before`/`around` 委托路径上以 `yield*` 委托，因此迭代语义得以保留；handler 提供的非可迭代替换值会直接返回。`after` 在迭代前观察 generator 对象（该操作无法在 yield 之间拦截）。
- **Node 加载期变换要求预编译 JavaScript。** loader 解析编译后的 JS；把原始 `.ts` 源码交给 Node load hook 会失败即显式。浏览器构建路径会在变换前剥离 TypeScript 注解（含 JSX）。
