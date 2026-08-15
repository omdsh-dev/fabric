# RFC:dsh-external-fabric — 仓库目的、架构与决策记录

[English](rfc.md) | 中文

- 状态:**活文档**(每节记录决策及其历史)
- 范围:本独立 Fabric 扩展仓库
- 上游锚点:deepseek-harness 快照 `7b9644f2`(0812)/ `9f9e2782a4`(0813)、fork tip `65bcaf9902`(`feat-fabric`)

本文解释这个仓库**为什么**长成现在的样子。下面每一处非常规安排都来自提交历史中一次具体的事故;各节按仓库演化顺序组织,而不是按文件布局。

---

## 1. 目的:外部化的 Fabric 扩展,而非 fork

deepseek-harness 是私有 monorepo。Fabric/Mixin 扩展层在其中以三个扩展包存在,但消费者无法从 registry 安装它们。本仓库把这**恰好三个包**外部化,使其能通过官方插件通道安装:

```
dsh plugin --profile <p> add github:dsh-external/fabric
```

**边界(硬规则):** 工作区只发布恰好三个完整包——`cordis-fabric`(纯转换服务)、`cordis-fabric-api`(纯 compat facade)、`cordis-fabric-dsh`(DSH 面 facade、invariant、profile bootstrap)。任何其他代码——包括官方 `@deepseek-ai/dsh-tool-cordis` 工具集——绝不作为第四个包加入;官方包通过 `patches/` 下的 pnpm 依赖补丁修正。

## 2. Host 集成:只保留接缝的 patch

三个包只会安装钩子与挂载 facade。拆分快照之前的 DSH host 从不调用它们,没有 host 侧接线整个 bundle 就是死的。接线以 `patches/fabric-host-integration.patch`(17 文件)发布,遵循一条规则:

> **实际代码保留,文档不保留,官方插件注册器能处理的不保留。**

官方通道已经覆盖的内容被刻意排除:安装 trio(`dsh plugin add`)、bundle 行名册与依赖、catalog 生成、trio-in-workspace 的 invariant/gate 豁免、以及全部文档(`README*`、`docs/`、`.agents/`)。剩下的是任何通道都提供不了的:launcher bootstrap(`apps/cli/src/profile-boot.ts` 在任何目标导入之前调用 `installFabricBootstrap`、boot 后调用 `checkFabricRequiredPatches`)、`clientBundle` 源码 transform 构建接缝(`packages/client/tsdown.client.ts`)、编译进官方 `tool-cordis` 包的 catalog 条目、它们的测试、以及 pnpm 策略接缝。

### 2.1 机械复现

`scripts/extract-patch.mjs` 根据 `patches/host-patch.config.json`(baseline / upstream / revert / seams / exclude)重新生成 patch:checkout upstream 提交、把 registry 处理的文件 revert 到 baseline、重放 seam 编辑(以及 `add` seam——两个快照都不存在的文件)、diff、并在 baseline 上验证正向 apply、在裁剪树上验证反向 apply。上游漂移的 seam 锚点会大声失败。

### 2.2 baseline 历史

fork 会 rebase 到更新的官方快照。patch 的 baseline 必须跟进,否则 diff 会把整整一个快照的主线噪声(CI 文件、文档、资源——数百文件)拖进 patch:

| Baseline | Upstream | 时期 |
|---|---|---|
| `7b9644f2`(0812) | `1de04707` | 初始外部化 |
| `9f9e2782a4`(0813) | `65bcaf9902` | fork rebase 0813 之后 |

### 2.3 disabled opt-in 行

web-app bundle 层把 `cordis-fabric` / `cordis-fabric-dsh` 行插入为 **disabled opt-in**:纯 `cordis-fabric` 包是没有插件 `apply` 的库,enabled 的行每次 boot 都失败("invalid plugin")。profile 通过启用这些行 opt-in;bundle 层每次 boot 都应用,因此既有的 profile 无需编辑即被覆盖。

### 2.4 TSX 死胡同(已记录并撤销)

`dsh` 的 source 启动(`node --import tsx/esm apps/cli/src/bin.ts`)一度看起来需要 `TSX_TSCONFIG_PATH` 或 register preload:`FiberState`(const enum,只在 `vendor/cordis/src` 存在)解析失败。两个 workaround 都曾发布,后来**全部撤销**——真正原因是 shell 里一个指向旧 staging checkout 的过期 `TSX_TSCONFIG_PATH`。干净环境下 tsx 自动发现入口的 tsconfig(继承 base)并把别名解析到 `src`。官方脚本原样运行;patch 中不存在相关接缝。

## 3. 安装模型:git 子目录 spec + prepare

trio 以 git 子目录 spec 被消费:

```
github:dsh-external/fabric#main&path:/packages/cordis-fabric
```

- host 源码安装在 `apps/cli/package.json`(patch 接缝)中声明它们;`pnpm install --no-frozen-lockfile` 拉取并构建;`scripts/install.sh` 创建/重建本地 `fabric` 分支(从 `master` 删除重建、丢弃未提交残留)、应用 patch、一次提交、安装、构建。
- 消费侧构建在隔离环境中运行 `prepare`(ex-setting 是 `tsdown.prepare.config.ts`,trio 是 `tsc -b && tsdown`)——devDependencies 在那里安装,因此 `lightningcss` 等可用。

### 3.1 pnpm 11 供应链接缝

pnpm 11 默认阻止 git 解析的安装;三道接缝使其工作:

- profile 模板中的 `blockExoticSubdeps: false`(git 解析的子依赖);
- host 工作区与 profile 模板中的 `dangerouslyAllowAllBuilds: true`(`allowBuilds` 只接受精确的 `git+url#commit` 键,而它每次推送都变);
- 本工作区的 `minimumReleaseAgeExclude: ['@deepseek-ai/dsh-*']`——dsh-* rc 序列总在 24h 窗口内发布,仅写包名豁免所有版本。

## 4. Registry 依赖策略

dsh-* host 包以快速 rc 序列发布;本仓库通过 registry 范围跟踪它们,每条教训都来自一次真实事故。

### 4.1 dsh-compact 陷阱

`@deepseek-ai/dsh-client-runtime@0.0.1-rc.1` 依赖 `@deepseek-ai/dsh-compact`,后者**从未发布**(上游发布该 runtime 之后删除了这个包)。`0.1.0-rc.x` 系列去掉了该依赖;已端到端验证可安装。

### 4.2 缺失的 rc.5

上游代码版本是 `0.1.0-rc.5`,但 registry 从 `rc.3` 直接跳到 `rc.6`——rc.5 从未发布。因此范围写作 `^0.1.0-rc.0`(解析最新发布的 rc,且 `rc.0` 使未来的稳定版也在范围内)。peer 使用相同范围,host workspace 的 rc.5 满足它——host 安装复用 workspace 包而非 registry 副本。

### 4.3 真实 host 类型,而非本地契约

trio 一度声明 `host-contracts.ts` facade 加一个全局 `@deepseek-ai/cordis` Events 注入。它破坏了 host 各包的类型检查,已删除,改为直接导入真实 `@deepseek-ai/dsh-*` 类型(声明为 peer + devDeps)——与上游形状一致。`ctx.slots` 的类型来自 `dsh-client-runtime` 的声明,与上游相同。

### 4.4 已发布 lib 的运行时 peer

在 `autoInstallPeers: false` 下,已发布 `dsh-*` lib 的加载期导入(`dsh-scope`、`dsh-llm`、`dsh-timeout`、`dsh-typert-protocol`)必须显式列入 devDependencies——每一个都是在测试加载时报 "Cannot find package" 后补上的。

## 5. 浏览器 client 格式:closure factory

web shell 以 classic script 加载 `/plugins/<id>/client.js`,值导入通过 loader 模块表(factory 内的同步 `require`)解析。纯 ESM 产物在那里完全加载不起来。因此 trio 的两个浏览器半边都发布为 closure factory:

```js
window.__ModuleLoader__.load({ id: "cordis-fabric", factory: (require) => { ...; return module.exports; } })
```

`@deepseek-ai/cordis` 保持 external(平台 seed),其余全部内联。先改的是 `cordis-fabric`;随后 `cordis-fabric-dsh`(同样的缺口,在 ex-setting 安装暴露第一个之后修复)。上游从不察觉——其 monorepo 通过共享的 `clientBundle()` 预设构建两者。

### 5.1 ex-setting 的三条教训(同一契约,外部仓库)

姊妹仓库 `omdsh-dev/ex-setting` 三次撞上同一契约:

1. 它的 `dsh.client` manifest 必须**嵌套**(`"dsh": { "client": ... }`),而非顶层 `dshClient` 字段——client-modules 扫描的是嵌套形式;
2. 消费侧构建必须用 **prepare 配置**,而不是只改本地配置,否则 git 安装仍在供应旧产物;
3. 跨 bundle 值导入不能指望 disabled 行的 factory——ex-setting 内联/避开模块表回答不了的东西,并把静态样式改为直接安装,而不是经由 Fabric publish(transform 无法匹配 closure 产物内部)。

## 6. 测试策略

上游套件通过 tsconfig paths 解析 `src`;本仓库只有 registry 的 `lib` 产物,这驱动了下述演化。

- **serve.spec** 挂载真实 `@deepseek-ai/dsh-host-webserver`(`^0.1.0-rc.0`——rc.1 仍注册 `httpServer`;`webServer` 在 rc.3 落地,与 serve 原语匹配)。
- **hmr-e2e-runner** 通过翻转 `cordis.yml` 里行的 `disabled` 标志驱动 config HMR:vendor fork 的 `hmr.registerConfig` 与 include `internal/update` 是 fork 私有,**任何** registry 版本都没有(对照最新 1.0.16/1.0.6 验证过)。
- **client spec** 最初 fake `CommandUiRuntime`/`SlotRegistry`,因为 runtime rc.1 依赖树装不了且 bundle 是 closure factory。rc.6 可装后真实原因只剩 factory 格式,于是 spec 通过测试模块加载器(`tests/module-loader.ts`)挂载**真实服务**:happy-dom 提供 `window`;`__ModuleLoader__` sink 在 helper 模块顶层安装;平台 seed(`cordis`、`ui-slots`、`react`)以 ESM namespace 预载(factory 的 `require` 是同步的,node 无法 require ESM);渲染专用的重型包 `ui-primitives` 用 stub;`materialize()` 以模块表 require 执行 factory(递归进入其他已注册 bundle、记忆化、`stripClientSuffix` 归一化 `pkg/client`)。Loader `baseUrl` 与 fixture URL 钉死为文件路径,因为 happy-dom 的 `location` 是 `http://localhost:3000`。

## 7. 时间线(节选)

| 提交 | 决策 |
|---|---|
| `1e04b1a`..`2a42254` | 外部化:独立 Fabric bundle、自包含模板 |
| `4018661`、`8ffaac4` | 移植上游三包拆分 + 全量 host patch;HMR e2e |
| `d9228c4`、`40600d4` | 官方插件通道安装;source-host 安装脚本 |
| `1ba7077`、`3331b80` | web-app bundle 组合行;行改为 disabled opt-in |
| `7b8e913`、`3fd3106` | patch rebase:0812 baseline → 0813 baseline |
| `9158f5d` | 删除 `host-contracts.ts`;真实 `@deepseek-ai/dsh-*` 类型 |
| `30ed5ff`、`b58c643` | registry 依赖策略(rc.5 peer、可安装套件) |
| `58fbe75`、`33955ef` | 两个浏览器半边改为 closure factory |
| `aa58a52` | 公开发布(与上游对齐) |
| `62ced22` | 撤销 TSX workaround(环境误诊) |
| `3fd1a56` | happy-dom + ModuleLoader materializer;测试挂真实浏览器服务 |

## 8. 后续工作

- 若 registry 将来发布 node 可导入的构建(纯 ESM 或 `src` 半边),测试模块加载器可删除,spec 直接 import 包。
- 上游把 `createSnapshotStore` 移出 `dsh-client-runtime` 会缩小 seed 表。
- 上游发布 `hmr.registerConfig` / `internal/update` 后,HMR runner 可重新镜像 in-tree 的 config 流程。
