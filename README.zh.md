# `@deepseek-ai/dsh-cordis-fabric`

[English](README.md) | 中文

Fabric/Mixin 扩展层的可安装 DSH profile 组合包。root package 提供可信的加载期变换服务，并通过 `@deepseek-ai/dsh-cordis-fabric/api` 导出面向 Mod 的合作式 API；浏览器侧把低层 bridge 与 Mod facade 合并为一个 `dshClient` entry。

## 仓库结构

```text
package.json              # root package 和 dsh.bundle/dshClient 清单
cordis.patch.yml          # 显式 Fabric host rows
src/                      # Fabric host、API、loader、browser 和 testkit entry
lib/                      # 生成的安装产物
legacy/                   # 旧 DSH 快照的宿主接线补丁，仅作迁移资料
docs/                     # Fabric 和 API 详细说明
tests/fabric/              # 变换、loader、browser 和 testkit 测试
tests/api/                 # 合作式 Host/client facade 测试
```

两个逻辑 face 共享一个 Git-installed package：

```text
@deepseek-ai/dsh-cordis-fabric          host transformation service
@deepseek-ai/dsh-cordis-fabric/api      Host cooperative facade
@deepseek-ai/dsh-cordis-fabric/client   combined browser face
```

组合包加入两个默认禁用的 Host 行。启用时 profile 可分别覆盖 `disabled`。Patch handler 是通过 `ctx.fabric.register()` 注册的可信代码；YAML 或模型输入永远不会反序列化可执行 handler。

新的 bundle 层只负责组合 package rows。Profile bootstrap、browser transform serve、client build seam、catalog 和 launcher dependency 必须由 profile 使用的 DSH 版本提供；旧宿主接线 diff 保留在 `legacy/` 中，不属于新的 bundle 契约。

## 开发

完整 typecheck 需要 sibling checkout：

```text
~/git/deepseek-harness
~/git/fabric
```

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

`prepare` 直接从 `src/` 构建 host、loader、testkit、API 和 browser entry，因此 Git 安装不需要 sibling project references。pnpm 10 可能要求 profile 允许 prepare 脚本；只应批准固定且可信的 checkout。

## 已知限制

- Node 加载期变换要求预编译 JavaScript；browser transform 会在应用 handler 前剥离 TypeScript。
- 为了 Git/profile 安装，browser face 有意合并；需要完整 SlotMap 类型的 consumer 应直接使用 DSH authoritative slot service。
- 旧 DSH 快照需要使用 `legacy/` 中的宿主接线补丁，因为 bundle 不能新增缺失的 loader 或 browser build 接缝。
