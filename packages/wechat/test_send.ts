#!/usr/bin/env bun
/**
 * 测试发送消息功能
 */

import { loadAccount, sendText } from "./src/api"

const account = await loadAccount()
if (!account) {
  console.error("加载账号失败")
  process.exit(1)
}

console.log("账号加载成功:", account.accountId)

// 测试发送消息
const testUserId = "o9cq80-fSaL6Qkl0hCChbVUcuOLs@im.wechat"
const testText = "这是一条测试消息"

console.log(`准备发送消息到: ${testUserId}`)
console.log(`消息内容: ${testText}`)

try {
  await sendText({
    to: testUserId,
    text: testText,
    baseUrl: account.baseUrl,
    token: account.token,
  })
  console.log("消息发送成功!")
} catch (err) {
  console.error("消息发送失败:", err)
}
