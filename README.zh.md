# `@deepseek-ai/dsh-cordis-fabric`

[English](README.md) | 中文

Fabric/Mixin 扩展层的可安装 DSH profile 组合包。root package 提供可信的加载期变换服务，并通过 `@deepseek-ai/dsh-cordis-fabric/api` 导出面向 Mod 的合作式 API；浏览器侧把低层 bridge 与 Mod facade 合并为一个 `dshClient` entry。

## 仓库结构

```text
package.json              # root package 和 dsh.bundle/dshClient 清单
AGENTS.md                 # 仓库内贡献规则
cordis.patch.yml          # 显式 Fabric host rows
docs/                     # Fabric、API 与契约详细说明
patches/README.md         # 可选 pnpm 依赖补丁契约
scripts/                  # 自包含 prepare 与边界验证
src/                      # Fabric host、契约、loader、browser 和 testkit entry
tests/                    # 变换、facade、组合与 serve 测试
lib/                      # 生成的安装产物
```

两个逻辑 face 共享一个 Git-installed package：

```text
@deepseek-ai/dsh-cordis-fabric          host transformation service
@deepseek-ai/dsh-cordis-fabric/api      Host cooperative facade
@deepseek-ai/dsh-cordis-fabric/client   combined browser face
```

## 仓库边界

本仓库完全自包含：所有源码、编译器配置、测试夹具、贡献说明和构建辅助都位于仓库根目录内，所有开发输入都从本仓库自身的 manifest 和 lockfile 解析。DSH 宿主包（`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-invariants` 以及 facade 委托的其他 `@deepseek-ai/dsh-*` 服务）是私有包，无法从 npm registry 安装；`src/host-contracts.ts` 声明了本包所需的最窄结构契约，运行时由组合后的 DSH profile 提供真实服务。

运行 `pnpm run verify:self-contained` 强制执行该边界：它拒绝本地路径依赖规格、离开仓库的编译器或代码路径、外部或损坏的 Markdown 链接、绝对工作站路径，以及任何仓库布局契约文件的缺失。

## 组合包行为

组合包加入两个默认禁用的 Host 行。启用时 profile 可分别覆盖 `disabled`。Patch handler 是通过 `ctx.fabric.register()` 注册的可信代码；YAML 或模型输入永远不会反序列化可执行 handler。服务支持 Node ESM/CommonJS 加载期变换、browser 构建期变换、优先级组合、HMR 安全销毁、静态目标校验、generator 委托和 watched browser transforms。

新的 bundle 层只负责组合 package rows。Profile bootstrap、browser transform serve、client build seam、catalog 和 launcher dependency 必须由 profile 使用的 DSH 版本提供。旧的宿主接线 diff 已随重构删除，不属于新的 bundle 契约。

## 开发

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
```

`pnpm run prepare` 是 Git 和 tarball 安装的消费侧产物构建：它使用本仓库已安装的依赖直接从 `src/` 生成声明与运行时 bundle，因此 Git 安装不需要 sibling project references 或其他 checkout。pnpm 可能要求 profile 允许 prepare 脚本；只应批准固定且可信的 checkout。

## 模型体验

低层 transformer 不产生任何模型可见内容。合作式 API 把 prompt、tools、commands、agent events 和浏览器 command/slot 注册全部委托给权威 DSH 服务；日志、权限、审批、取消和渲染语义由这些属主保留。

## 已知限制

- Node 加载期变换要求预编译 JavaScript；browser transform 会在应用 handler 前剥离 TypeScript。
- 为了 Git/profile 安装，browser face 有意合并；需要完整 SlotMap 类型的 consumer 应直接使用 DSH authoritative slot service。
- 面向旧 DSH 快照的宿主接线补丁已随重构移除；bundle 不能新增缺失的 loader 或 browser build 接缝。
