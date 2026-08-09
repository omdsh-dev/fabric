# dsh Fabric 插件

这是从最新 DeepSeek Harness `feat-fabric` worktree 中重新提取出的独立发布目录。

源码 worktree：`/home/raum/deepseek-harness/fabric`。

最新上游提交：`b059f8d0 test(fabric): resolve face-aware client bundle config`。

宿主补丁基线：该 feature worktree 的共同基线 `5b7d50a8`。

> 当前 `/home/raum/deepseek-harness/fabric` 是 DSH source worktree，不是这个发布目录。插件发布内容放在本目录，避免覆盖 source worktree。

## 包含内容

```text
packages/cordis/cordis-fabric/       低层 Fabric/Mixin patch runtime
packages/cordis/cordis-fabric-api/   面向 Mod 的合作式 API facade
patches/fabric-plugin.patch          DSH 宿主接缝补丁
```

插件包名：

```text
@deepseek-ai/dsh-cordis-fabric
@deepseek-ai/dsh-cordis-fabric-api
```

## 最新功能

### `dsh-cordis-fabric`

低层 Fabric/Mixin 风格扩展层，基于 Orchestrion 对可信 Cordis plugin 的目标函数做加载期转换，支持：

- `before`
- `after`
- `around`
- `replace`
- Node ESM / CommonJS load-time transformation
- CommonJS re-transform 和 HMR 生命周期
- Browser bundle-time transform
- 按 priority 组织多个 patch
- 静态 target validation 和 fail-loud registration
- workspace package identity 解析
- 多 selector 命中逐个转换
- generator / async generator 转换
- constructor target 拒绝
- async loader fallback 和多 installation 链接
- face-aware client bundle composition anchor 和 served bundle route
- watched browser transform、serve seam 和 testkit
- keyed-slot arbitration 与 bridge-backed compatibility facade

patch handler 是可信代码，通过运行时 `ctx.fabric.register()` 注册，不从 YAML 或模型输入反序列化可执行逻辑。

### `dsh-cordis-fabric-api`

面向 Mod 的稳定合作式 API facade，delegates 到现有 DSH authoritative services，不复制领域状态：

```text
fabricAgent
fabricTools
fabricPrompt
fabricCommands
fabricCompat
fabricClient
```

提供 Agent、Tools、Prompt、Commands、compat adapter，以及浏览器 Command/Slot API。所有注册都是 fiber effect，返回底层 disposer，支持 HMR-safe disposal。

两个包都采用显式 opt-in，默认组合不启用。

## 安装到 DSH

以下命令在目标 DSH 仓库根目录执行。宿主补丁基于 `5b7d50a8`；其他基线需要先确认补丁可以安全应用。

### 1. 复制两个插件包

```sh
cp -a /path/to/fabric-plugin/packages/cordis/cordis-fabric \
  packages/cordis/
cp -a /path/to/fabric-plugin/packages/cordis/cordis-fabric-api \
  packages/cordis/
```

### 2. 应用宿主补丁

```sh
git apply --check /path/to/fabric-plugin/patches/fabric-plugin.patch
git apply /path/to/fabric-plugin/patches/fabric-plugin.patch
```

补丁包含：

- `apps/cli` package dependency、profile boot bootstrap 和 fixture runner
- bundle web-app 的 Fabric patch 配置
- browser `clientBundle` source-transform 接缝
- `tsconfig.host.json` / `tsconfig.client.json` references
- Cordis service catalog、module graph、config catalog 和文档接缝
- workspace constraints、knip 和 README gates
- Fabric bootstrap、catalog、browser build 和开发期测试
- 最新 workspace-package identity 和 loader 接线

补丁不包含两个插件包本体、`pnpm-lock.yaml`、Agent Notes 或自动生成的 `THIRD_PARTY_NOTICES.md`。复制包后由目标 workspace 重新生成 lockfile 和 notices。

### 3. 安装并构建

```sh
pnpm install
pnpm exec tsc -b packages/cordis/cordis-fabric
pnpm exec tsc -b packages/cordis/cordis-fabric-api
```

如果需要使用浏览器 half，还要执行目标 DSH 的前端 build；两个包的 `dshClient` rows 默认 disabled，需要在用户 overlay 中显式启用。

## Model Experience

Fabric 本身不直接生成模型请求；低层 patch runtime 没有 model-visible 内容。Fabric API 通过 authoritative DSH owners 间接影响 tools、prompt sections 和 commands，而这些内容继续遵守原服务的日志、权限、审批和取消契约。

## 已知限制与待办

- **Hooks 留存到进程结束，state 不会。** `registerHooks` hooks 会组合并留存；disposer 移除该安装的 state（hooks 变为透传，缓存 transformer 被释放）。每次安装捕获自己的 state 并通过自己的 matcher 变换，因此并发安装彼此隔离；共享的 CommonJS `_compile` wrapper 按安装序链式经过每个活跃安装。异步 `module.register` fallback 通过共享配置文件达到相同语义：loader-thread entry 在每次加载时读取当前安装栈，因此被 dispose 的安装会在下次求值时停止变换 ESM。按 pid 命名的配置文件在进程退出时删除。
- **CommonJS 与 ESM 模块在两条 hook 路径上均可重新变换。** 已经求值的模块可以在当前安装栈下重新求值：CommonJS 和 ESM 都会驱逐 Node 内部 `loadCache` 条目及相关状态，下一次 `require()` / `import()` 会以当前安装栈重新运行 hooks。HMR 周期先 dispose 旧安装再重新求值；ESM 重新 import 失败时会恢复被驱逐的条目。ESM 重变换要求 Node ≥ 22，async `module.register` fallback 同样支持。
- **同一函数上的多个 patch 按 priority 叠加。** 高 priority 的 handler 先执行；相等 priority 保持安装序。跨安装时后安装的 patch 包裹最外层，与 priority 无关。同一目标上的两个 `replace` patch 在注册时被拒绝。
- **箭头目标和 generator 有明确的转换边界。** 箭头目标支持标识符、rest、默认值和解构参数；读取外层 `arguments` 的函数体会保留，但参数名为 `arguments` 的箭头会被跳过。generator 通过 `yield*` 委托保留迭代语义；`after` 只能在迭代前观察 generator 对象，无法在 yield 之间拦截。
- **Node 加载期变换要求预编译 JavaScript。** loader 解析编译后的 JavaScript，把原始 `.ts` 源码交给 Node load hook 会失败；浏览器构建路径会在变换前剥离 TypeScript 注解（含 JSX）。
- **Fabric API 是经过策划的子集，不是完整镜像。** 只有真实 Mod consumer 需要且 domain service 本身没有承诺的兼容边界时，模块才进入 Fabric API；其余能力以 domain service 为权威面。
- **Client slot face 是窄子集。** `ctx.fabricClient.registerSlot` 接受稳定的 `FabricSlotOptions`；完整的 SlotMap 类型机制和 composed-props 推断保留在 `dsh-client-ui-slots`，需要完整类型化 register 契约的 Mod 应直接使用该 service。
- **Cordis service catalog 不收录模块 service。** Catalog projector 只记录位于 `src/index.ts` 或 `src/service.ts` 的 service 类，Fabric API 的模块 service 位于各自 entry 文件，因此需要以本 README 和两个包的 README 为准。

完整 API、平台说明和限制见两个包的 README。

## 发布

本插件仓库已发布到：

<https://github.com/dsh-external/fabric>

主分支当前包含最新 Fabric 提取提交；`example/ui-bash` 分支还包含从 `interruption-fabric` 提取的 UI Bash 示例。

两个插件包均沿用 BSD-3-Clause 许可。发布到组织仓库时，请按组织要求补充仓库级 LICENSE 和版权信息。
