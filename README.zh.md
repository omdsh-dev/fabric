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

本仓库完全自包含:所有源码、编译器配置、测试夹具、贡献说明和构建辅助都位于仓库根目录内,所有开发输入都从本仓库自身的 manifest 和 lockfile 解析。DSH 宿主包(`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-invariants` 以及 facade 委托的其他 `@deepseek-ai/dsh-*` 服务)可从 npm registry 安装;facade 直接导入它们的真实类型(声明为 peer + dev 依赖),运行时由组合后的 DSH profile 提供真实服务。

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

新的 bundle 层只负责组合 package rows。三包要真正运行所需的 launcher/bootstrap 接线由即插即用的 `fabric-dsh` 命令在启动时注入——宿主源码完全不动(宿主补丁现已为空;见 `patches/README.md`)。直接跑官方 `dsh` 只走官方代码;`fabric-dsh` 注入 loader hooks。

## 安装

bundle 通过 DSH 官方 bundle 插件通道安装;三包通过 git 子目录 spec 从本 GitHub 仓库解析,无需发布:

```sh
dsh plugin --profile web add github:dsh-external/fabric
```

装完重启 web。profile 行为默认禁用的 opt-in;在 profile 组合中启用 `cordis-fabric` / `cordis-fabric-dsh` 即激活 Fabric 层。

仓库不带任何构建产物:三包的 `prepare` 脚本在 Git 安装时构建 `lib/`(pnpm 会安装该包的 devDependencies 并在消费者机器上运行 `prepare`)。安装跟随 `main`。

Fabric 层要真正生效,load-time 变换钩子必须在任何目标模块导入前存在。`fabric-dsh` 启动器做到这一点,宿主零改动。它随 bundle 一起装进 profile,所以 profile 装好 bundle 后不再需要 bundle 仓库检出,直接跑 profile 自带的 bin:

```sh
# dsh 从 registry 安装(项目依赖或 PATH 上的全局命令)
$DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh --port 8000

# 针对纯官方 deepseek-harness checkout
$DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh \
  --source <deepseek-harness-checkout> web --port 8000
```

(DSH_HOME 与 profile 名从安装路径自身推导。不带 `--source` 时运行注册表安装的 `@deepseek-ai/dsh`——发布的 CLI 入口是纯 ESM,无需 tsx 与源码检出;CLI 依次从 `DSH_CLI`、调用方项目依赖、PATH 上的 `dsh` 解析,能跟随 pnpm 的 cmd-shim 脚本。开发形态 `node <bundle-repo>/scripts/fabric-dsh.mjs --source <checkout> --profile web ...` 仍然可用。)

首次准备(在本 bundle 仓库里执行):`pnpm run install:host -- <deepseek-harness-checkout> [--dsh-home <目录>]`——宿主装依赖 + 构建、profile 播种(git 依赖三包需要的 pnpm 设置)、官方插件通道装 bundle(`dsh plugin --profile web add github:dsh-external/fabric`,并把 `cordis-fabric-bundle` 并入 `dsh.profile.bundles`)、启用 `cordis-fabric-dsh` 行。宿主补丁为空,不打补丁、不建分支。

`fabric-dsh` 组合 profile 的补丁层,把合成的 descriptors 写入 `$DSH_FABRIC_CONFIG`,通过 `--import` 注入 `packages/cordis-fabric/preload.mjs`(在 CLI 入口加载前注册 loader hooks;三包从 profile 解析,保证 hooks 与插件共享同一模块实例——preload 先于 CLI 自身的 boot 执行,故先 heal profile 的模块回退),源码检出形态下钉住 tsx tsconfig,并在缺省时追加 profile 的 pnpm 设置(`blockExoticSubdeps: false`、`dangerouslyAllowAllBuilds: true`)。声明 `config.fabric.patches` 的行即 Fabric 依赖行:默认 disabled,fabric-dsh 用生成的 overlay 启用它——普通 `dsh` 启动完全跳过这类行(应用照常运行、依赖插件不加载),fabric-dsh 则在 hooks 就位后加载它们,Host 插件在启动后一个 tick 校验 required 绑定;在普通 `dsh` 下显式启用 Fabric 依赖行会直接拒启。启动输出在 stderr 上标识 fabric 启动:hooks 装好时打 `fabric-dsh:` 标记,随后打印 hook 汇总,列出每条 patch 及其命中的目标文件。

**npm 安装的官方 `dsh`** — 直接可用:不带 `--source` 的 `fabric-dsh` 运行注册表安装的 CLI(预构建入口是纯 ESM,preload 照常注入),无需源码检出、tsx 或宿主补丁。

两个前提:

- pnpm 通过 SSH 解析 GitHub 依赖,安装机器需要对 `dsh-external/fabric` 有 GitHub SSH 访问权;
- 启动必须走 `fabric-dsh`(直接跑 `dsh` 不激活 Fabric hooks);见上面。

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
- npm 安装的官方 `dsh` 上无法运行 `fabric-dsh`(CLI 预构建,没有源码入口可 preload);这类宿主要等官方合入接线。源码宿主一律通过 `fabric-dsh` 启动(见安装章节)。
