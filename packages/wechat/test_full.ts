#!/usr/bin/env bun
/**
 * 完整测试：模拟收到消息后的完整处理流程
 */

import { createOpencode } from "@opencode-ai/sdk"
import { loadAccount, sendText } from "./src/api"

// 加载账号
const account = await loadAccount()
if (!account) {
  console.error("加载账号失败")
  process.exit(1)
}
console.log("✅ 账号加载成功:", account.accountId)

// 启动 opencode
const opencode = await createOpencode({ port: 0 })
console.log("✅ Opencode 服务就绪:", opencode.server.url)

const testUserId = "o9cq80-fSaL6Qkl0hCChbVUcuOLs@im.wechat"
const testText = "你好，测试消息"

console.log("\n=== 步骤 1: 创建会话 ===")
const createResult = await opencode.client.session.create({
  body: { title: `微信用户 ${testUserId}` },
})
if (createResult.error) {
  console.error("创建会话失败:", createResult.error)
  process.exit(1)
}
const sessionId = createResult.data.id
console.log("✅ 会话创建成功:", sessionId)

console.log("\n=== 步骤 2: 发送 prompt 到 AI ===")
const promptBody = { parts: [{ type: "text", text: testText }] }
const aiResult = await opencode.client.session.prompt({
  path: { id: sessionId },
  body: promptBody,
})

console.log("AI响应 error:", aiResult.error ? 'yes' : 'no')
console.log("AI响应 data:", JSON.stringify(aiResult.data, null, 2).slice(0, 1000))

const response = aiResult.data
const textParts = response.parts
  ?.filter((p: any) => p.type === "text")
  .map((p: any) => p.text) ?? []

console.log("textParts数量:", textParts.length)
console.log("textParts内容:", textParts)

const responseText =
  response.info?.content ||
  response.content ||
  textParts.join("\n") ||
  response.message ||
  response.text ||
  ""

console.log("响应文本长度:", responseText.length)
console.log("响应文本:", responseText)

if (!responseText) {
  console.error("❌ 响应文本为空")
  process.exit(1)
}

console.log("\n=== 步骤 3: 发送微信消息 ===")
console.log("准备发送消息到:", testUserId)
console.log("消息内容:", responseText)

try {
  await sendText({
    to: testUserId,
    text: responseText,
    baseUrl: account.baseUrl,
    token: account.token,
  })
  console.log("✅ 微信消息发送成功!")
} catch (err) {
  console.error("❌ 微信消息发送失败:", err)
}

opencode.server.close()
