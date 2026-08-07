# dsh Fabric 插件

这是从最新 DeepSeek Harness `feat-fabric` worktree 更新出的独立发布仓库。

最新上游提交：`a84fba6 feat(fabric): transform every selector match and reject constructor targets`。

宿主补丁基线：当前 DSH `origin/master` `5b7d50a8`（2026-08-06 snapshot）。

远程仓库：<https://github.com/dsh-external/fabric>

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

## 本次上游更新

本次同步带入了 Fabric 分支后续的大批实现和运行时修复：

- selector 命中全部目标时逐个转换，并拒绝 constructor target
- generator / async generator 使用 `yield*` delegation 转换
- async `module.register` loader-thread fallback 的安装级状态链
- 多安装并发时的 CommonJS `_compile` wrapper 链接
- 已评估 ESM 的 load-cache eviction 和重新转换
- watched patch-set 变化时重新构建 client bundle
- 更完整的 arrow target 支持、参数冲突规避和 outer `arguments` 保护
- profile boot 阶段恢复并强化 Fabric launcher bootstrap
- browser source-transform 和开发期 Fabric build 测试
- 最新 Fabric service catalog、module graph、config catalog 和测试

## 功能

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

以下命令在目标 DSH 仓库根目录执行。宿主补丁基于 `origin/master` `5b7d50a8`；其他基线需要先确认补丁可以安全应用。

### 1. 复制两个插件包

```sh
cp -a /path/to/fabric/packages/cordis/cordis-fabric \
  packages/cordis/
cp -a /path/to/fabric/packages/cordis/cordis-fabric-api \
  packages/cordis/
```

### 2. 应用宿主补丁

```sh
git apply --check /path/to/fabric/patches/fabric-plugin.patch
git apply /path/to/fabric/patches/fabric-plugin.patch
```

补丁包含：

- `apps/cli` package dependency、profile boot bootstrap 和 fixture runner
- bundle web-app 的 Fabric patch 配置
- browser `clientBundle` source-transform 接缝
- `tsconfig.host.json` / `tsconfig.client.json` references
- Cordis service catalog、module graph、config catalog 和文档接缝
- workspace constraints、knip 和 README gates
- Fabric bootstrap、catalog、browser build 和开发期测试
- 最新 root build dependency 与 package metadata

补丁不包含两个插件包本体、`pnpm-lock.yaml`、Agent Notes 或自动生成的 `THIRD_PARTY_NOTICES.md`。复制包后由目标 workspace 重新生成 lockfile 和 notices。

### 3. 安装并构建

```sh
pnpm install
pnpm exec tsc -b packages/cordis/cordis-fabric
pnpm exec tsc -b packages/cordis/cordis-fabric-api
```

如果需要使用浏览器 half，还要执行目标 DSH 的前端 build；`cordis-fabric` 和 `cordis-fabric-api` 的 `dshClient` rows 默认 disabled，需要在用户 overlay 中显式启用。

## Model Experience

Fabric 本身不直接生成模型请求；低层 patch runtime 没有 model-visible 内容。Fabric API 通过 authoritative DSH owners 间接影响 tools、prompt sections 和 commands，而这些内容继续遵守原服务的日志、权限、审批和取消契约。

## 已知限制

- load-time hooks 会保留到进程结束，disposer 只停用 installation state
- ESM 重新转换依赖 load-cache eviction；无法卸载的外部 ESM 状态不会被重置
- selector 命中多个函数时会全部转换；constructor target 会被明确拒绝
- Node load-time transformation 需要预编译 JavaScript；原始 `.ts` 由 Node load hook 加载会失败
- Fabric API 是经过筛选的 facade，不是所有底层服务的完整镜像

完整 API、平台说明和限制见两个包的 README。

## 更新和发布

本仓库已经连接到目标远程。确认校验通过后提交并推送：

```sh
cd /home/raum/deepseek-harness/fabric
git add .
git commit -m 'chore: refresh Fabric plugins'
git push origin main
```

两个插件包均沿用 BSD-3-Clause 许可。发布到组织仓库时，请按组织要求补充仓库级 LICENSE 和版权信息。
