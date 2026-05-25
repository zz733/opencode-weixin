#!/usr/bin/env bun
/**
 * 微信机器人登录脚本
 * 扫描二维码完成登录并保存账号信息
 */

import { startLogin, waitForLogin, DEFAULT_BASE_URL } from "./src/auth"
import { saveAccount } from "./src/api"

console.log("🤖 OpenCode 微信机器人登录\n")

// 开始登录流程
const startResult = await startLogin({})

if (!startResult.qrcodeUrl) {
  console.error("❌ 获取二维码失败:", start