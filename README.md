# OpenCode 微信机器人

基于腾讯官方 **ilink API**，将 OpenCode AI 集成到微信，让微信变成你的 AI 助手。

## 功能特性

- 微信官方 ilink API 接入，安全稳定
- 扫码登录，Token 持久化，自动重连
- 文本对话、图片识别、语音转文字
- 多模型切换（/m）、多 Agent 切换（/a）
- 后台服务模式运行，日志输出
- 单实例锁，防止重复启动
- 长文本自动分段发送

## 安装

```bash
npm install -g opencode-wechat-bot
```

## 快速开始

### 1. 扫码登录

首次使用需要扫码登录微信：

```bash
opencode-wechat --login
```

用微信扫描终端显示的二维码，登录成功后账号会自动保存。

### 2. 启动机器人

**前台运行**（可看到实时输出）：

```bash
opencode-wechat
```

**后台服务模式**（推荐）：

```bash
opencode-wechat --daemon
```

### 3. 管理服务

```bash
opencode-wechat --status          # 查看服务状态
opencode-wechat --stop            # 停止后台服务
opencode-wechat --daemon --log /path/to/log.log  # 指定日志文件
```

## 命令列表

在微信聊天中发送以下命令：

| 命令 | 说明 |
|------|------|
| `/new` | 创建新会话 |
| `/m` | 选择模型供应商和模型 |
| `/a` | 选择 Agent |
| `/d` | 显示当前工作目录 |
| `/cd <目录>` | 切换工作目录 |
| `/s` | 列出所有会话 |
| `/c` | 取消当前操作 |
| `/h` | 显示帮助信息 |

直接发送文字消息即可与 AI 对话，发送图片会自动识别，发送语音会自动转文字。

## 命令行选项

```
opencode-wechat                   前台运行
opencode-wechat --login           扫码登录微信
opencode-wechat --daemon          后台服务模式启动
opencode-wechat --stop            停止后台服务
opencode-wechat --status          查看服务状态
opencode-wechat --log <file>      指定日志文件（默认 opencode-wechat.log）
opencode-wechat --url <URL>       连接到已有的 opencode 服务
opencode-wechat --help            显示帮助信息
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `OPENCODE_API_KEY` | opencode API 密钥（使用 --url 时需要） |

## 注意事项

- 建议使用新注册的微信小号作为机器人
- 遵守微信使用条款和相关法律法规
- 后台模式运行时，日志默认输出到当前目录的 `opencode-wechat.log`
- 同一目录下只能运行一个实例，重复启动会提示已有进程

## 从源码运行

```bash
cd packages/wechat
bun install
bun run src/cli.ts
```

## License

MIT
