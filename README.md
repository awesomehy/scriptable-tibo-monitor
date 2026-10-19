# Tibo Monitor · Scriptable 桌面小组件

在 iOS 桌面展示 [Tibo 今天重置吗？](https://tibo-monitor.hhyan.me/) 的最近消息。无需登录、无需 Token、无第三方依赖。

- 小 / 中 / 大组件默认展示最近 **1 / 3 / 6 条**，可分别调整。
- 优先显示中文翻译；未完成时显示原文和翻译状态，不把“未判定”显示成“重置：否”。
- 同时显示手机上次成功同步消息时间、网站上次成功采集时间，全部为北京时间。
- 支持浅色、深色及随系统切换；中、大组件可点消息打开原文。
- 网络失败保留缓存和原同步时间；不会显示虚构消息。
- Scriptable 内一键从此 GitHub 仓库更新代码，更新前备份，可恢复旧版。

## 安装

1. 在 iPhone 安装 Scriptable。
2. 打开 [TiboMonitor.js 源码](https://raw.githubusercontent.com/awesomehy/scriptable-tibo-monitor/main/TiboMonitor.js)，复制全部内容。
3. 打开 Scriptable，点右上角 `+`，粘贴代码，命名为 `TiboMonitor` 并保存。
4. 运行一次，选择小、中或大尺寸预览，允许网络访问。
5. 长按 iOS 桌面，添加对应尺寸的 **Scriptable** 小组件。
6. 长按组件 → 编辑小组件 → `Script` 选择 `TiboMonitor`。`When Interacting` 可选 `Open URL`；脚本会设置网站及消息链接。`Parameter` 留空即可。

小组件的数据来自网站已保存的数据，刷新不会触发网站重新抓取，也不会发送微信通知。

## 一键更新

在 Scriptable 内运行 `TiboMonitor`，点击 **一键更新脚本** 即可。中、大组件底部也提供“更新脚本”入口，会打开 Scriptable 执行同一更新操作。小组件后台只读取消息，不静默改写代码。

更新从 `awesomehy/scriptable-tibo-monitor` 的 `main` 分支取得最新提交，固定该提交后下载 `update.json` 和脚本，检查版本、脚本标识、SHA-256 和语法，然后写入临时文件、备份并替换当前脚本。下载、校验或写入失败会保留原脚本；SHA-256 用于检查下载完整性，信任来源仍是此仓库及 HTTPS。

更新后关闭当前运行并重新运行，新代码才会生效。桌面组件由 iOS 后续调度刷新。菜单中的 **恢复更新前版本** 可恢复最近一次成功更新前的代码。支持 Scriptable 本地存储和 iCloud 存储；备份在当前设备本地，不跟随 iCloud 跨设备同步。

用户设置保存在各个小组件的 `Parameter` 中，更新不会覆盖。直接修改脚本源码的自定义内容会在更新时替换，请将显示选项放到 `Parameter` 中。

## 参数

`Parameter` 支持数字或 JSON。数字 `2` 表示当前组件显示最近两条。

完整示例：

```json
{"counts":{"small":1,"medium":2,"large":5},"refreshMinutes":15,"language":"zh","theme":"auto"}
```

| 参数 | 默认值 | 可选范围 |
| --- | --- | --- |
| `count` | 按尺寸决定 | 覆盖当前尺寸的条数 |
| `counts.small` | 1 | 1–2 |
| `counts.medium` | 3 | 1–3 |
| `counts.large` | 6 | 1–7 |
| `refreshMinutes` | 15 | 1–1440，缓存读取间隔及最早刷新申请 |
| `language` | `zh` | `zh` 优先中文；`en` 显示原文 |
| `theme` | `auto` | `auto` / `light` / `dark` |

条数较少时分配更多正文行；多条模式会截取摘要，完整内容可点消息查看。超出范围或 JSON 格式错误会显示参数提示。支持桌面小、中、大三种尺寸，锁屏和 iPad 额外大尺寸不在本脚本的支持范围内。

## 时间与状态

| 显示 | 含义 |
| --- | --- |
| 消息旁的日期 | 原帖发布时间 |
| 上次同步 / 同步 | 本机最近一次成功读取并校验 `/api/tweets` 的时间 |
| 网站采集 / 采集 | `/api/status` 的 `source.lastSuccessAt`，网站最近一次自动采集成功的时间 |
| 缓存·失败 | 消息读取失败，仍显示此前保存的消息和成功时间 |
| 状态未知 / 采集(旧) | 采集状态读取失败；保留的采集时间来自旧快照 |
| 采集暂停 / 降级 / 等待 / 异常 | 来自本次网站采集状态，成功读取网页数据不代表采集恢复 |

两个接口分别处理失败：消息读取成功但状态接口失败时，消息可以更新，采集时间保留并标旧。接口返回空数组才表示暂无消息，网络或格式错误不当作空消息成功。历史 `lastError` 不单独决定当前采集状态。

各尺寸共享本地缓存，避免同时读取重复数据。接口返回 HTTP 429 时遵守 `Retry-After`，手动预览也不会绕过等待期限。应用内预览会在未限流时重新读取数据。

`refreshMinutes` **不能保证定时刷新**。根据 [Scriptable 的刷新规则](https://docs.scriptable.app/listwidget/#refreshafterdate)，`refreshAfterDate` 是最早可刷新时间，实际刷新由 iOS 决定，低电量等情况可能延后。组件停留期间，显示的成功时间也会保持原样，便于判断数据年龄。

## 接口说明

已对照网站接口文档、服务端实现和线上只读响应核实，使用：

- `GET /api/tweets` → `{ "tweets": [...] }`，最近最多 50 条主动帖子。
- `GET /api/status` → `{ "source": { "state": "healthy", "lastSuccessAt": "..." }, "intervalMinutes": 5, ... }`。

消息读取 `id`、`text`、`url`、`publishedAt`、`isDemo`、`translation` 和 `resetClassification`。仅使用 `translation.status === "complete"` 的非空译文；仅在 `resetClassification.status === "complete"` 且值为布尔型时显示“重置：是/否”。优先按发布时间倒序，同一时间按字符串形式的数字 ID 倒序，避免 JavaScript 大整数精度丢失。

本脚本采用公开消息接口，未使用需要个人只读凭据的 `/api/integrations/astrbot/feed`，也不访问账号、绑定、管理员或发送接口。

## 开发与发布

需要 Node.js 24，无需安装 npm 依赖。

```sh
npm test
npm run check:live
```

测试覆盖尺寸条数、消息排序、翻译与判定状态、部分接口失败、缓存与成功时间、限流等待、更新校验、备份和写入失败恢复。原生 WidgetKit 的字体、尺寸和 iCloud 行为仍需在 iPhone / Scriptable 中实测；Node 测试使用模拟的 Scriptable API。

发布新版本：修改 `TiboMonitor.js` 内 `// version:` 与 `const VERSION`，同步 `package.json` 版本，运行 `npm run release` 生成对应的 `update.json`，再运行 `npm test`。将脚本与更新清单放在同一个提交中推送至 `main`，用户下一次点击更新即可获取。

更新脚本内的配置字段是稳定接口，请在后续版本中保留兼容性。不要把凭据、网站私有源码或本地缓存提交到此公开仓库。
