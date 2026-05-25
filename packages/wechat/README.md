# OpenCode 微信机器人

基于腾讯官方 **ilink API**（`ilinkai.weixin.qq.com`），将 OpenCode 集成到微信。

---

## 🚀 最简单的运行方式（推荐）

您已经有 OpenCode 项目了，直接运行：

```bash
cd /Users/liuguanghua/CascadeProjects/opencode/packages/wechat
npm install
npm link
opencode-wechat
```

如果 npm install 失败，直接用项目根目录的 bun 运行：

```bash
cd /Users/liuguanghua/CascadeProjects/opencode
./packages/wechat/src/cli.ts
```

或：

```bash
cd /Users/liuguanghua/CascadeProjects/opencode
cd packages/wechat
bun run src/cli.ts
```

---

## 📦 文件结构

```
packages/wechat/
├── src/
│   ├── index.ts       # 核心代码
│   ├── api.ts         # 微信官方 API
│   ├── auth.ts        # 登录
│   ├── messenger.ts   # 发消息
│   ├── types.ts       # 类型
│   └── cli.ts         # 命令行入口
├── install.sh         # 本地安装脚本
└── standalone/        # 独立版本（从 monorepo 分离）
```

---

## ✨ 功能特性

- ✅ 微信官方 API (`ilinkai.weixin.qq.com`)
- ✅ 二维码扫码登录
- ✅ 消息长轮询接收
- ✅ Token 持久化（下次自动登录）
- ✅ 会话上下文管理
- ✅ 工具调用通知

---

## ⚠️ 注意事项

- 建议使用新注册的微信小号作为机器人
- 遵守微信使用条款和相关法律法规
