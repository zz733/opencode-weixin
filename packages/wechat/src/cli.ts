#!/usr/bin/env node
/**
 * OpenCode 微信机器人 CLI 入口。
 * 支持全局安装后通过命令行直接运行。
 *
 * 使用方式：
 *   opencode-wechat              # 直接运行（需要已有账号）
 *   opencode-wechat --login      # 扫码登录微信
 *   opencode-wechat --serve      # 先启动 opencode serve
 *   opencode-wechat --url <URL>  # 连接已有服务
 */

import { runBot } from "./index"
import { startLogin, waitForLogin } from "./auth"

const args = process.argv.slice(2)

// 解析命令行参数
let serverUrl: string | undefined
let autoServe = false
let doLogin = false

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--serve":
      autoServe = true
      break
    case "--login":
      doLogin = true
      break
    case "--url":
      serverUrl = args[++i]
      break
    case "--help":
    case "-h":
      console.log(`
OpenCode 微信机器人

使用方式：
  opencode-wechat                   直接运行（需要已有账号）
  opencode-wechat --login           扫码登录微信账号
  opencode-wechat --serve           先启动 opencode serve，再连接
  opencode-wechat --url <URL>       连接到已有的 opencode 服务

选项：
  --login            扫码登录微信账号
  --serve            启动 opencode 服务（端口自动分配）
  --url <URL>        连接到已有的 opencode 服务地址
  --help, -h         显示帮助信息

环境变量：
  OPENCODE_API_KEY    opencode API 密钥（需要 --url 时使用）
`)
      process.exit(0)
  }
}

if (doLogin) {
  console.log("正在获取登录二维码...")
  const result = await startLogin({ force: true })
  if (result.qrcodeUrl) {
    console.log("\n请用微信扫描以下二维码登录：")
    console.log(result.qrcodeUrl)
  }

  console.log("\n等待扫码确认...")
  const waitResult = await waitForLogin({ sessionKey: result.sessionKey, timeoutMs: 300000 })

  if (waitResult.connected) {
    console.log("\n✅ 登录成功！账号已保存到 wechat-account.json")
  } else {
    console.log("\n❌ 登录失败:", waitResult.message)
    process.exit(1)
  }
} else {
  runBot({ serverUrl, autoServe }).catch((err: unknown) => {
    console.error("❌ 机器人运行失败:", err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
