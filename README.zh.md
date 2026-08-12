# Cordis Fabric Workspace

[English](README.md) | 中文

Fabric/Mixin 扩展层的自包含 workspace:三个完整包 + 一个可安装的 profile bundle 载体。结构对齐上游 fabric 拆分:纯 Cordis 对(`cordis-fabric`、`cordis-fabric-api`)与 DSH 集成包(`cordis-fabric-dsh`,提供 Host/浏览器 facade、包 invariant 与 profile bootstrap)。

## 包

| 包 | 类型 | 内容 |
|---|---|---|
| `cordis-fabric` | 纯 Cordis | 可信加载期变换服务(`FabricService`、`bootstrapFabric`)、Orchestrion 变换、node-loader hooks、bridge、browser transform、testkit。无任何 DSH 导入。 |
| `cordis-fabric-api` | 纯 Cordis | 基于 fabric registry 的合作式 compat facade:`FabricCompatService` + `buildCompatInstrumentations`。peer 只依赖 Cordis 与 `cordis-fabric`。 |
| `cordis-fabric-dsh` | DSH 面 | Mod-facing facade(`ctx.fabricAgent`、`ctx.fabricTools`、`ctx.fabricPrompt`、`ctx.fabricCommands`)、浏览器 facade(`ctx.fabricClient`)、包 invariant 与 profile bootstrap(`installFabricBootstrap`)。 |

本仓库只存在这三个完整包。三包之外的任何代码——包括官方的 `@deepseek-ai/dsh-tool-cordis` 工具集或需要修正的上游依赖——一律不作为第四个包加入,而是以 pnpm 依赖补丁的形式存放在 `patches/` 中(见 `patches/README.md`)。

## 仓库结构

```text
package.json              # workspace 根与 dsh.bundle bundle 载体
pnpm-workspace.yaml       # packages/* workspace
cordis.patch.yml          # 显式 Fabric profile rows(opt-in,默认禁用)
AGENTS.md                 # 仓库内贡献规则
docs/                     # Fabric、API 与契约详细说明
patches/README.md         # pnpm 依赖补丁契约
scripts/                  # 自包含 prepare 与边界验证
packages/
  cordis-fabric/          # 纯变换服务 + 浏览器 client entry
  cordis-fabric-api/      # 纯 compat facade(peer-only 库)
  cordis-fabric-dsh/      # DSH facades、invariant、profile bootstrap
lib/                      # 构建产物(已忽略;每个包在安装时自行 prepare)
```

## 仓库边界

本仓库完全自包含:所有源码、编译器配置、测试夹具、贡献说明和构建辅助都位于仓库根目录内,所有开发输入都从本仓库自身的 manifest 和 lockfile 解析。DSH 宿主包(`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-invariants` 以及 facade 委托的其他 `@deepseek-ai/dsh-*` 服务)是私有包,无法从 npm registry 安装;`packages/cordis-fabric-dsh/src/host-contracts.ts` 声明了 facade 所需的最窄结构契约,运行时由组合后的 DSH profile 提供真实服务。

运行 `pnpm run verify:self-contained` 强制执行该边界:它拒绝本地路径依赖规格、离开仓库的编译器或代码路径、外部或损坏的 Markdown 链接、绝对工作站路径,以及任何仓库布局契约文件的缺失。

## 组合包行为

bundle 载体加入两个默认禁用的 profile 行:

```yaml
- id: cordis-fabric
  name: 'cordis-fabric'
  disabled: true

- id: cordis-fabric-dsh
  name: 'cordis-fabric-dsh'
  disabled: true
```

Patch handler 是通过 `ctx.fabric.register()` 注册的可信代码;YAML 或模型输入永远不会反序列化可执行 handler。服务支持 Node ESM/CommonJS 加载期变换、browser 构建期变换、优先级组合、HMR 安全销毁、静态目标校验、generator 委托和 watched browser transforms。

新的 bundle 层只负责组合 package rows。三包要真正运行所需的 launcher/bootstrap 与 browser build 接缝是宿主侧代码,不属于三包,以 `patches/fabric-host-integration.patch` 携带(对快照 `4ee4ae88` 的 deepseek-harness checkout 执行 `git apply`;见 `patches/README.md`)。已到拆分提交的宿主无需任何补丁。

## 安装

bundle 通过 DSH 官方 bundle 插件通道安装;三包通过 git 子目录 spec 从本 GitHub 仓库解析,无需发布:

```sh
dsh plugin --profile web add github:dsh-external/fabric
```

装完重启 web。profile 行为默认禁用的 opt-in;在 profile 组合中启用 `cordis-fabric` / `cordis-fabric-dsh` 即激活 Fabric 层。

仓库不带任何构建产物:三包的 `prepare` 脚本在 Git 安装时构建 `lib/`(pnpm 会安装该包的 devDependencies 并在消费者机器上运行 `prepare`)。安装跟随 `main`。

Fabric 层要真正生效,宿主 launcher 必须在任何目标模块导入前调用三包的 bootstrap。官方 DSH master 目前没有这一步。两种宿主情形:

**源码宿主(现在就能完整可用)** — deepseek-harness checkout + 宿主补丁(`patches/fabric-host-integration.patch`,见 `patches/README.md`)。补丁接好 launcher、browser build 接缝和 tool-cordis catalog;CLI 的三包依赖是 git spec,纯官方 checkout 在 `pnpm install` 时就能拉取并现造三包:

```sh
git clone <deepseek-harness> && cd deepseek-harness
pnpm run patch:host -- .          # 在本 bundle 仓库里执行;或 git apply 补丁
pnpm install --no-frozen-lockfile # 首次安装:lockfile 新增两个 git 依赖,
                                  # 从 GitHub 拉三包,prepare 现造 lib
pnpm run build
pnpm dsh web            # web-app bundle 层已组合 fabric 两行
```

**npm 安装的官方 `dsh`** — 无法打源码补丁(CLI 是预构建产物);等官方仓库合入接线后即可(拆分提交 `0e1065d4` 已包含)。

两个前提:

- pnpm 通过 SSH 解析 GitHub 依赖,安装机器需要对 `dsh-external/fabric` 有 GitHub SSH 访问权;
- load-time 变换钩子必须在任何目标模块导入前由宿主 launcher 安装;见上面的宿主情形。

## 开发

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
```

`lib/` 是构建产物,永不提交:由三包的 `prepare` 脚本重建(根 `build` 脚本在本地执行它们)。本 workspace 中,root manifest 对三包的 git 子目录 spec 通过 `pnpm-workspace.yaml` 的 overrides 指回本地包,`pnpm install` 不会重复克隆仓库。

## 模型体验

低层 transformer 不产生任何模型可见内容。合作式 facade 把 prompt、tools、commands、agent events 和浏览器 command/slot 注册全部委托给权威 DSH 服务;日志、权限、审批、取消和渲染语义由这些属主保留。

## 已知限制

- Node 加载期变换要求预编译 JavaScript;browser transform 会在应用 handler 前剥离 TypeScript。
- 浏览器面分布在两个双面包中(`cordis-fabric/client` 提供 bridge 与 service,`cordis-fabric-dsh/client` 提供 Mod-facing facade);需要完整 SlotMap 类型的 consumer 应直接使用 DSH authoritative slot service。
- npm 安装的官方 `dsh` 上,load-time 与 browser build 接缝不生效(CLI 预构建,打不了源码补丁);这类宿主要等官方合入接线。源码宿主用 `patches/fabric-host-integration.patch` 补齐接缝(见 `patches/README.md`)。
