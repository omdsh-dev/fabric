# dsh Fabric 插件

这是从 DeepSeek Harness `feat-fabric` worktree 中分离出的独立发布目录。

上游提交：`04bbb03 docs(fabric): classify the fabric-api services in the capability graph`。

宿主补丁基线：当前 DSH `origin/master` `93fe8cc2`。

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

以下命令在目标 DSH 仓库根目录执行。宿主补丁基于 `origin/master` `93fe8cc2`；其他基线需要先确认补丁可以安全应用。

### 1. 复制两个插件包

```sh
cp -a /path/to/fabric-plugin-release/packages/cordis/cordis-fabric \
  packages/cordis/
cp -a /path/to/fabric-plugin-release/packages/cordis/cordis-fabric-api \
  packages/cordis/
```

### 2. 应用宿主补丁

```sh
git apply --check /path/to/fabric-plugin-release/patches/fabric-plugin.patch
git apply /path/to/fabric-plugin-release/patches/fabric-plugin.patch
```

补丁包含：

- `apps/cli` 的 Fabric host/browser roster 依赖和 opt-in rows
- `AppCLIEntry` 的 pre-config-tree Fabric bootstrap
- `clientBundle` 的可选 browser source transform hook
- `tsconfig.host.json` / `tsconfig.client.json` references
- Cordis service catalog、module graph、config catalog 和文档接缝
- workspace constraints、knip 和 README gates
- Fabric bootstrap、catalog 和 host 接线测试
- 所需的 `@apm-js-collab/code-transformer`、`module-details-from-path`、`typescript` 依赖以及 root build dependency

补丁不包含两个插件包本体、`pnpm-lock.yaml`、Agent Notes 或自动生成的 `THIRD_PARTY_NOTICES.md`。复制包后由目标 workspace 重新生成 lockfile 和 notices。

### 3. 安装并构建

```sh
pnpm install
pnpm exec tsc -b packages/cordis/cordis-fabric
pnpm exec tsc -b packages/cordis/cordis-fabric-api
```

如果需要使用浏览器 half，还要执行目标 DSH 的前端 build；`cordis-fabric` 和 `cordis-fabric-api` 的 `dshClient` rows 默认 disabled，需要在用户 overlay 中显式启用：

```yaml
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

- id: cordis-fabric-api
  disabled: false
```

`cordis-fabric-api` 的 Host bundle 可以直接挂载，或按需使用 `./agent`、`./tools`、`./prompt`、`./commands`、`./compat` 和 `./client` 子路径。

## Model Experience

Fabric 本身不直接生成模型请求；低层 patch runtime 没有 model-visible 内容。Fabric API 通过 authoritative DSH owners 间接影响 tools、prompt sections 和 commands，而这些内容继续遵守原服务的日志、权限、审批和取消契约。

## 已知限制

- load-time hooks 会保留到进程结束，disposer 只停用 installation state
- ESM 没有等价于 CommonJS 的 unload/re-transform 路径
- Arrow target 只支持普通 identifier 参数
- Generator function target 会被跳过
- Node load-time transformation 需要预编译 JavaScript；原始 `.ts` 由 Node load hook 加载会失败
- Fabric API 是经过筛选的 facade，不是所有底层服务的完整镜像

完整 API、平台说明和限制见两个包的 README。

## 发布到 GitHub

本目录目前只完成本地整理，没有配置 remote，也没有推送。

在 GitHub 创建目标仓库后执行：

```sh
cd /home/raum/deepseek-harness/fabric-plugin-release
git add .
git commit -m 'feat: publish Fabric plugins'
git branch -M main
git remote add origin <GitHub 仓库 URL>
git push -u origin main
```

两个插件包均沿用 BSD-3-Clause 许可。发布到组织仓库时，请按组织要求补充仓库级 LICENSE 和版权信息。
