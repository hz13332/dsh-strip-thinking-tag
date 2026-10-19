# dsh-strip-thinking-tag

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件：把模型偶尔写进**正文**通道的 `<thinking>…</thinking>` 小抄摘掉，让它既不出现在聊天里，也不落进会话日志。

[English](README.md) | 中文

## 问题

`dsh` 把「思考」和「正文」分成两条独立通道。规矩的模型把思维链走 `reasoning` 通道，界面折叠显示，永远不混进回复。

但有些模型偶尔会把一段思考直接写进正文：

```json
{"type":"text","text":"<thinking>Let me read the spec doc first.</thinking>Here is the answer…"}
```

没有任何环节会摘掉它，于是读者看到的就是一对原始标签。同一个会话里通常还有几百个完全正常的 `reasoning` 块，所以这个泄漏看起来像随机的 —— 它是模型间歇性的输出行为，不是配置问题。`llm-pi-ai` 的兼容开关也治不了：`thinkingFormat` 决定请求**怎么问**推理，`requiresThinkingAsText` 决定历史思考**怎么回放**，两者都不碰模型返回的正文。

## 它做什么

插件挂在 `llm/stream` 瀑布上，**只改写正文块**：

- 块首以 `<thinking>` 开头的正文块 —— 允许前导空白 —— 连标签带内容一起摘掉。
- 块尾未闭合的 `<thinking>`：该块剩余部分全部丢弃。
- 其余一律原样透传。`reasoning` 通道一字不动，工具调用、用量与结束分片同样不碰。

因为它坐在模型输出的接缝上，这段小抄既不会出现在实时流里，也不会被写进会话日志。

### 刻意收窄的匹配

只摘**块首**命中的情况。标签出现在句子中间时 —— 比如某条回复正在讨论这个标签本身 —— 原样保留。实测到的每一次泄漏都发生在块首，所以这条规则能清掉噪音，又不会误伤正当提到该标签的文字。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-strip-thinking-tag
```

包内声明了 `dsh.bundle` 清单，安装即挂载它自己的补丁层。若你的 profile 不热重载补丁，装完重启宿主即可。

也可以直接从本仓库装：

```sh
dsh plugin --profile <你的 profile> add github:hz13332/dsh-strip-thinking-tag
```

## 边界与安全

- 零依赖，自身不读写文件、不联网 —— 只对拿到的数据流做变换。
- 发往提供方的请求不被修改。
- 单文件，约 110 行。

## 测试

```sh
node test.mjs
```

15 项断言，覆盖跨分片被切开的标签（`<thin` + `king>`）、未闭合标签、前导空白形态，以及反例 —— 出现在正文中间的同名标签必须原样保留。样本字符串取自真实会话日志。

## 卸载

```sh
dsh plugin --profile <你的 profile> remove dsh-strip-thinking-tag
```

## 许可

MIT