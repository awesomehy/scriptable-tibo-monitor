# Tibo Monitor · Widgy / Watchy

在 Apple Watch 上显示网站最新一条公开消息、上次成功读取时间及重置判定。中文翻译未完成时自动显示原文和状态；所有时间为北京时间。正文固定长度摘要，不随消息长度改变字号。

**交付方式：可粘贴的 JavaScript 数据源和下面的布局配置。** 本目录没有经 Widgy 原生导出、真机验证的 `.widgy` 文件或导入二维码；`TiboWatchy.js` 不能通过“导入组件”安装，需要在 Widgy 中创建一个文字层后粘贴。当前电脑无法运行 iPhone / Watchy，因此实际编辑器名称、手表排版和同步效果仍需在设备上确认。

## 1. 安装应用

1. 在 iPhone 安装或更新 [Widgy：中国大陆 App Store](https://apps.apple.com/cn/app/widgy-widgets-home-lock-watch/id1524540481)，开发者为 **Woodsign**。Watchy 是 Widgy 的手表功能，不需要寻找另一个名为 Watchy 的独立商店条目。
2. 在 iPhone 的 **Watch** App → **我的手表** 中确认手表端 Widgy / Watchy 已安装；如果在“可用 App”中，点安装。手表保持与 iPhone 配对且联网。
3. 打开 iPhone Widgy，进入 **Watchy / Apple Watch** 区域。建议使用商店可获得的最新版；开发者在新版中修复过 Apple Watch 异步 JavaScript 和同步问题。如果某个槽位显示需购买，以应用内实际说明为准，先在编辑器中运行数据源确认可用。

## 2. 创建矩形组件

建议先做表盘中央的**矩形复杂功能**，容纳消息比圆形槽位更合适。不同版本的编辑器位置及中文翻译可能有差异，下文同时写出英文名称。

1. 在 Watchy 区域点 **创建 / Create → 新建 / New**，选择供矩形复杂功能使用的画布（Rectangular / Graphic Rectangular），命名 `Tibo 最新消息`。
2. 新增 **文字 / Text** 层，铺满可用画布，四边留约 4% 空白。
3. 进入该层的 **数据 / Data → JavaScript**，选择 **Async + No main()**。必须选异步模式，而不是要求返回 `main()` 的同步模式。
4. 打开 [TiboWatchy.js 全部源码](https://github.com/awesomehy/scriptable-tibo-monitor/blob/main/watchy/TiboWatchy.js)，复制全文，覆盖代码框中的示例代码。
5. 点 **运行 / Run**。成功结果应包含下面三部分；示例为排版示意，消息以实时接口为准：

   ```text
   Tibo · 刷新 10/19 18:30
   最新一条中文消息摘要…
   帖 10/19 12:32 · 重置：否
   ```

6. 确认结果后保存。整个动态内容只使用**一个文字层**，消息和刷新时间从同一次成功请求生成；不要另建一个“当前时间”层充当刷新时间。

建议排版：

| 项目 | 设置 |
| --- | --- |
| 背景 | 黑色或系统默认 |
| 字色 | 白色 / 系统前景色；表盘着色模式可能统一颜色 |
| 字体 | System Regular，固定字号，视觉大小约 11–12 pt |
| 对齐 | 左对齐、顶部对齐 |
| 换行 | 允许多行；给全部内容留约 4–5 行空间 |
| 缩放 | 关闭自动缩小（若该版本提供此选项） |
| 消息长度 | 默认最多 28 个字符，包含省略号；小尺寸手表可改为 20 |

`MAX_BODY_CHARS` 位于脚本开头，改小可以减少换行、保证时间仍显示。字号在 Widgy 文字层中设定；脚本输出普通文字，不控制字体。不要增加外部图片层，以免增加下载和内存消耗。

## 3. 同步与放到表盘

1. iPhone Widgy → **管理 / Manage → Watchy**，将 `Tibo 最新消息` 分配给可用的矩形复杂功能槽位；记住所选槽位。
2. 在 Apple Watch 上打开 **Watchy / Widgy**，让它保持在前台，再在 iPhone Widgy 中执行 **同步到 Apple Watch / Sync to Watch**，等同步结束后在手表中查看。
3. 长按 Apple Watch 表盘 → **编辑 → 复杂功能**，选择支持矩形大槽位的表盘（例如模块 / Modular），点中央矩形区域，选择 **Watchy / Widgy** 及上一步对应槽位，再按 Digital Crown 保存。也可通过 iPhone Watch App 编辑该表盘的复杂功能。
4. 检查手表上能看到摘要和 `刷新 MM/DD HH:mm`。看不到 Watchy 选项时，先确认手表端安装完成、同步完成、表盘槽位形状与分配的组件类型一致。

若想在 **Watchy 应用内**看更长内容，另建或复制一个适合应用全屏的 Watchy 画布，将脚本开头 `MODE = "compact"` 改为 `MODE = "full"`，正文上限变为 160 个字符，文字层给更多高度。全屏画布与表盘复杂功能的槽位需要分别分配；长文仍可能截断，完整原帖可在 iPhone 网站查看。

## 4. 刷新时间怎么理解

- **刷新**：本次脚本运行成功读取、校验 `/api/tweets` 后的时间。Watchy 如果复用旧画面，显示的也是那次读取时间，不会自行走动。
- **帖**：当前所显示原帖的发布时间。它可能比刷新时间早很多，这不代表刷新失败。
- 读取成功不意味着网站刚刚重新采集过 X，也不保证网站没有漏帖。
- 网络、格式或 HTTP 错误会输出“刷新失败”，不显示新的成功时间；没有自行持久化缓存。系统如果没有重绘而保留旧画面，旧时间也会保留。
- 脚本**不设置定时器轮询**，只在 Watchy 调用时请求一次。8 秒定时器仅用于终止等待，不是刷新频率。

在你的 Widgy / Watchy 槽位设置中，如果提供自动刷新选项，可开启并选择它允许的间隔。**不能承诺每 10 分钟更新 Apple Watch 表盘**；最终运行和重绘受 watchOS、联网及后台条件影响，Scriptable 的 10 分钟设置也不会传到 Watchy。急需确认时打开手表端 Watchy 触发重新加载；若该版本提供刷新按钮，使用它，并确认显示时间实际变化。

每次脚本实际运行仅调用一次公开消息 API，不需要登录或 Token，不读取私人订阅，不请求 `/api/status`，不触发采集、翻译或微信推送。同一数据源复制到多个组件时会分别运行，不能假定跨组件共享缓存；预览、同步也可能使应用额外运行脚本。

## 5. 常见问题

| 现象 | 处理 |
| --- | --- |
| 出现 `main`、Promise 或 unsupported type 错误 | 确认选择 **Async + No main()**，只粘贴源码，不含 Markdown 代码围栏；更新 Widgy 后重新同步 |
| iPhone 能运行、手表不能 | 确认手表端版本和联网；手表打开 Watchy 在前台，再次同步。手机预览成功不能证明手表运行成功 |
| 显示刷新失败 / fetch 相关错误 | 在 iPhone 浏览器检查网站是否可访问；确认已使用仓库最新代码。公开消息接口已为不携带凭据的跨域 GET 开放，不要加登录 Cookie 或 Authorization |
| HTTP 429 | 稍后再手动重试；脚本不自动循环重试，避免增加请求 |
| 字太小或时间被裁掉 | 保持固定字号，把 `MAX_BODY_CHARS` 改小，扩大文字层，再同步 |
| 时间一直不变 | 这是上次成功读取时间；打开 Watchy 检查数据源和联网，再重新加载，避免将系统时钟替代它 |
| 未译内容或待判定 | 网站尚未完成处理；显示原文及真实状态，不将未知判定作“否” |

## 验证范围与参考

已验证 JavaScript 的成功、空结果、长文本、翻译等待、判定等待、HTTP / 网络 / 格式失败及超时处理；公开消息接口已部署跨域支持，并通过浏览器跨域读取和线上数据源运行检查。没有 iPhone / Apple Watch 真机运行或原生导入测试。调整代码后需要重新粘贴并同步，Scriptable 菜单中的“一键更新”只更新 Scriptable 脚本。

- [Apple 官方：自定 Apple Watch 表盘和复杂功能](https://support.apple.com/guide/watch/customize-the-watch-face-apda6559ad78/watchos)
- [Widgy 开发者：异步 JavaScript 的 sendToWidgy 用法](https://www.reddit.com/r/widgy/comments/ojnju9/165_has_been_released/)
- [Widgy 开发者：新版 Watchy 同步、JavaScript 与槽位设置改动](https://www.reddit.com/r/widgy/comments/1w5rb1m/announcing_widgy_v27_public_beta_next_week/)
- [Widgy / Watchy 开发者 FAQ：同步时打开手表端应用](https://www.reddit.com/r/widgy/comments/v3jslo/widgywatchy_faq_and_feature_requests_megathread/)（历史 FAQ 中关于复杂功能不支持 JavaScript 的旧限制，不能替代新版能力说明。）
