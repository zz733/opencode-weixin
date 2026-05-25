#!/usr/bin/env node
/**
 * OpenCode 微信机器人 CLI 入口。
 * 支持全局安装后通过命令行直接运行。
 *
 * 使用方式：
 *   opencode-wechat              # 直接运行
 *   opencode-wechat --serve      # 先启动 opencode serve
 *   opencode-wechat --url http://localhost:4096  # 连接已有服务
 */

import { runBot } from "./index"

const args = process.argv.slice(2)

// 解析命令行参数
let serverUrl: string | undefined
let autoServe = false

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--serve":
      autoServe = true
      break
    case "--url":
      serverUrl = args[++i]
      break
    case "--help":
    case "-h":
      console.log(`
OpenCode 微信机器人

使用方式：
  opencode-wechat                   直接运行（自动启动内置 opencode 服务）
  opencode-wechat --serve           先启动 opencode serve，再连接
  opencode-wechat --url <URL>       连接到已有的 opencode 服务

选项：
  --serve             启动 opencode 服务（端口自动分配）
  --url <URL>         连接到已有的 opencode 服务地址
  --help, -h          显示帮助信息

环境变量：
  OPENCODE_API_KEY    opencode API 密钥（需要 --url 时使用）
`)
      process.exit(0)
  }
}

runBot({ serverUrl, autoServe }).catch((err: unknown) => {
  console.error("❌ 机器人运行失败:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
