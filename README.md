<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="Kite Logo" />
</p>
<h1 align="center">Kite</h1>
<p align="center">在本机旁路观察 Pi 的执行过程，同时查看多个会话，并重放每一步。</p>
<p align="center"><a href="docs/README.en.md">English</a></p>

## 这是什么

Kite 是面向 Pi 用户的本地执行观察工具，由一个被动扩展、SQLite 采集器和网页界面组成。你仍然在 Pi CLI 中工作；Kite 接收公开钩子的通知，将会话、上下文准备、模型响应和工具执行呈现在同一个界面中。

扩展不会发送提示词、选择工具、修改上下文或替你回答确认。采集格式保留原始事件和关联信息，不包含界面状态；其他来源也可以使用同一存储协议。数据保留在本机，不发送到远程服务。

## 功能

- **多会话总览**：按来源、Pi session 和录制实例区分记录，显示工作目录、模型、最新阶段与活动时间；大屏模式隐藏导航，集中观察全部会话。
- **执行过程可视化**：八个模块展示会话、输入、上下文、压缩、Provider、响应、工具和收尾过程，随观察到的事件高亮并播放动画。
- **细节查看**：时间线、模块筛选、内容搜索、原始事件载荷、并行工具尝试，以及 Provider 暴露的文本和 thinking 片段。
- **历史重放**：SQLite 按接收时间保留七天历史，支持逐步播放、原始时间间隔、0.5–8× 倍速和跨段重放。
- **被动采集**：覆盖 Pi 0.87.1 已发布的 39 个扩展钩子。回调只入队，不等待采集器；批量传输、重试和去重在旁路完成。
- **本地界面**：Basalt 明暗主题、移动端布局、键盘定位与减少动态效果偏好。

界面呈现的是扩展实际观察到的事件。工具开始表示一次执行尝试，验证或策略仍可能阻止工具运行；`agent_end` 与最终 `agent_settled` 分开显示。没有新事件不代表进程已经退出。

## 使用

### 安装并启动

需要 Node.js 24+（包含 `node:sqlite`）和已安装的 Pi 0.87.1。当前在 macOS、Node.js 26.9.0 上验证；采集器使用 Unix domain socket，需要支持该机制的运行环境。

```sh
git clone https://github.com/nocoo/kite.git
cd kite
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run build
pi install "$PWD"
```

在仓库目录启动采集器，并保持终端运行：

```sh
npm start
```

另开一个终端，在同一仓库目录启动网页：

```sh
npm run dev
```

打开 <http://127.0.0.1:7055>，然后在任意工作目录启动 `pi`。安装命令将本仓库加入 Pi 全局扩展包列表，保留已有包。已经运行的 Pi 需要执行 `/reload` 或重启。

本机已配置 Caddy 的开发环境也可访问 <https://kite.dev.hexly.ai>；这是指向本机的开发域名，不是公开托管服务。源码安装不会自动配置 DNS、TLS 或 Caddy。

### 观察与重放

选择会话卡片查看模块图、事件时间线、工具和原始载荷。**From start** 从保留历史的开头进入重放，**Live** 跟随最新事件；滑块和前后按钮定位单步，计时模式与倍速控制播放节奏。恢复同一个 Pi session 会生成新的录制实例。

每个历史分段最多 500 个事件、4 MiB；重放可跨段，段内计数和投影仅描述该段。实时窗口最多保留 500 个事件、约 8 MiB 的序列化 UTF-16 数据，更早的上下文可通过历史访问。序列缺口、丢失通知和截断标记保持可见。

### 存储与命令行

默认数据目录是 `~/.local/state/kite`，数据库为 `events.sqlite`，通信 socket 为 `collector.sock`。

```sh
node dist/cli.js --version
node dist/cli.js events --limit 100
node dist/cli.js events --after 100 --session SESSION_ID
node dist/cli.js export > trace.jsonl
```

`events` 返回一页 JSON；`export` 按存储游标导出 JSONL。两者接受 `--dir`、`--after`、`--limit`、`--session` 和 `--source`。

用 Ctrl+C 停止采集器。程序不会自动删除已有 socket；异常退出后，应确认原采集器已停止，再移除其残留 socket。卸载全局扩展可运行 `pi remove /absolute/path/to/kite`。

**记录可能包含私密内容**：提示词、路径、源码、工具输出和 Provider 暴露的 thinking。请求头、凭证形态字段和识别出的二进制/图片对象会被过滤，普通文本里的秘密仍可能保留。目录权限为 `0700`，数据库和 socket 为 `0600`；分享记录前应检查内容。

采集为尽力交付。长时间离线、队列溢出或强制终止可能丢失事件。扩展无法获知完整 SDK/RPC 重试调度、全部队列状态、任意子会话或其他扩展内部过程；未发布的 `provider_stream_event` 不在 Pi 0.87.1 采集范围内。

## 开发

安装步骤见上文。常用命令：

```sh
npm run dev
npm run build
npm run preview
```

`dev` 和 `preview` 都绑定 `127.0.0.1:7055`，不能同时使用；后者读取构建结果，两者都需要独立运行的采集器。Vite 的同源只读 API 通过 Unix socket 访问数据，浏览器不能通过该接口写入事件。

更换存储目录时，采集器使用 `--dir`，Pi 与 Vite 进程都需要相同的 `KITE_SOCKET`。以下三个命令分别在独立终端运行：

```sh
node dist/cli.js serve --dir /absolute/private/directory
KITE_SOCKET=/absolute/private/directory/collector.sock npm run dev
KITE_SOCKET=/absolute/private/directory/collector.sock pi
```

查询自定义目录时为 CLI 传入对应的 `--dir`。预览服务器也通过 `KITE_SOCKET` 选择采集器。

| 路径 | 职责 |
| --- | --- |
| `src/` | 扩展适配、采集与传输、SQLite、CLI 和网页只读 API |
| `web/model.ts` | 将事件映射为可观察的模块与状态 |
| `web/view-model.ts` | 轮询、选择、取消、筛选和重放逻辑 |
| `web/App.tsx` | Basalt 视图与交互绑定 |
| `tests/`、`scripts/` | 单测、真实 Pi 探针、浏览器验收与采集基准 |

## 测试

依赖安装完成后运行静态检查和单测：

```sh
npm run check
```

`check` 执行 Biome、TypeScript 和 Vitest/V8。采集器、Model 与 ViewModel 由单测验证；React 视图另由浏览器验收验证。

真实 Pi 集成验证需要 Python 3、Pi 0.87.1 和已构建的 CLI：

```sh
npm run build
python3 scripts/probe-collector.py
node scripts/benchmark-capture.mjs
```

探针使用独立临时采集器、隔离的 Pi 配置和本地测试 Provider，检查重试、并行/阻止/无效工具、重启持久化，以及采集器离线时 Pi 仍可完成。不会调用付费模型。基准只测量使用模拟确认的回调采集与入队开销，不代表磁盘或网络吞吐。

全局扩展和浏览器验收需要已经运行的采集器与网页、全局安装的 Kite 扩展、相邻的 `../archy` 工作目录、本机 Google Chrome，以及可访问的 `https://kite.dev.hexly.ai` 开发映射：

```sh
python3 scripts/observe-local.py
node scripts/browser-check.mjs
```

先运行观察脚本，它通过全局扩展发现启动两个真实 Pi 进程，用本地测试 Provider 生成可重放记录；再运行浏览器验收。后者检查会话与目录、重放、筛选、主题、大屏、断线恢复、加载/空状态、移动端和减少动态效果，截图写入忽略目录 `.local/evidence/`。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript、Node.js | Pi 扩展、采集服务、CLI 与共享类型 |
| SQLite（`node:sqlite`） | 本地事件、录制摘要和七天历史 |
| React、Vite | 网页渲染、本地开发和同源 API 桥接 |
| Basalt、Lucide | 界面组件、主题、设计 Token 与图标 |
| Vitest、Playwright | 逻辑单测和真实浏览器验收 |

## 文档

- [版本管理与发布流程](docs/releases.md)
- [版本更新记录](CHANGELOG.md)
- [采集协议、边界与交付保证](docs/collector.md)
- [界面架构、MVVM 与重放设计](docs/interface.md)
- [Pi 扩展钩子调研与源码依据](docs/research/pi-execution-visualization.md)
- [品牌资源与出处](assets/brand/README.md)

## 许可证

代码采用 [MIT License](LICENSE)。品牌图像的生成与使用出处见[品牌说明](assets/brand/README.md)。
