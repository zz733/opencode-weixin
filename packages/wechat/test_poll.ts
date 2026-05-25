#!/usr/bin/env bun
/**
 * 模拟微信消息接收和处理的完整测试
 */

import { createOpencode } from "@opencode-ai/sdk"
import { loadAccount, sendText, getUpdates } from "./src/api"

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

// 先获取当前的 get_updates_buf
console.log("\n=== 获取当前消息位置 ===")
const initialUpdates = await getUpdates({
  baseUrl: account.baseUrl,
  token: account.token,
  get_updates_buf: "",
  timeoutMs: 5000,
})
let getUpdatesBuf = initialUpdates.get_updates_buf ?? ""
console.log("当前 buf:", getUpdatesBuf?.slice(0, 50) + "...")

console.log("\n=== 请在微信中发送一条消息（5秒内）===")
await new Promise(r => setTimeout(r, 5000))

console.log("\n=== 轮询新消息 ===")
for (let i = 0; i < 3; i++) {
  console.log(`轮询 ${i + 1}...`)
  const updates = await getUpdates({
    baseUrl: account.baseUrl,
    token: account.token,
    get_updates_buf: getUpdatesBuf,
    timeoutMs: 10000,
  })
  
  console.log("收到 updates:", JSON.stringify({
    ret: updates.ret,
    msgs_count: updates.msgs?.length ?? 0,
    has_buf: !!updates.get_updates_buf
  }))
  
  if (updates.msgs?.length) {
    for (const msg of updates.msgs) {
      console.log("消息 from:", msg.from_user_id)
      console.log("消息内容:", msg.item_list?.[0]?.text_item?.text)
      
      if (msg.from_user_id?.endsWith("@im.wechat")) {
        const text = msg.item_list?.[0]?.text_item?.text
        if (text) {
          console.log("\n=== 处理消息:", text, "===")
          
          // 创建会话
          const createResult = await opencode.client.session.create({
            body: { title: `微信用户 ${testUserId}` },
          })
          const sessionId = createResult.data.id
          console.log("会话创建:", sessionId)
          
          // 发送 AI prompt
          const aiResult = await opencode.client.session.prompt({
            path: { id: sessionId },
            body: { parts: [{ type: "text", text }] },
          })
          
          const response = aiResult.data
          const textParts = response.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text) ?? []
          
          const responseText = textParts.join("\n") || response.info?.content || ""
          console.log("AI响应:", responseText)
          
          if (responseText) {
            // 发送微信消息
            await sendText({
              to: testUserId,
              text: responseText,
              baseUrl: account.baseUrl,
              token: account.token,
            })
            console.log("✅ 微信消息已发送!")
          }
        }
      }
    }
    
    if (updates.get_updates_buf) {
      getUpdatesBuf = updates.get_updates_buf
    }
    break
  }
  
  if (updates.get_updates_buf) {
    getUpdatesBuf = updates.get_updates_buf
  }
}

opencode.server.close()
console.log("\n测试完成")
