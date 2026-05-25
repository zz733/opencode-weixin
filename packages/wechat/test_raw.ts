#!/usr/bin/env bun
/**
 * 直接测试 getUpdates API，查看原始响应
 */

import { loadAccount } from "./src/api"

const account = await loadAccount()
if (!account) {
  console.error("加载账号失败")
  process.exit(1)
}

console.log("账号:", account.accountId)
console.log("baseUrl:", account.baseUrl)

// 直接调用 getUpdates
const body = JSON.stringify({ get_updates_buf: "" })
console.log("\n请求 body:", body)

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 15000)

try {
  const res = await fetch(`${account.baseUrl}/ilink/bot/getupdates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${account.token}`,
      "iLink-App-Id": "bot",
    },
    body,
    signal: controller.signal,
  })
  
  clearTimeout(timer)
  
  console.log("\n响应状态:", res.status)
  console.log("响应头:", Object.fromEntries(res.headers.entries()))
  
  const rawText = await res.text()
  console.log("\n原始响应 (前2000字符):", rawText.slice(0, 2000))
  
  const parsed = JSON.parse(rawText)
  console.log("\n解析后:")
  console.log("  ret:", parsed.ret)
  console.log("  msgs 类型:", typeof parsed.msgs, Array.isArray(parsed.msgs))
  console.log("  msgs 长度:", parsed.msgs?.length ?? 0)
  console.log("  get_updates_buf:", parsed.get_updates_buf?.slice(0, 50) + "...")
  
  if (parsed.msgs?.length) {
    console.log("\n消息列表:")
    for (const msg of parsed.msgs) {
      console.log("  from:", msg.from_user_id)
      console.log("  text:", msg.item_list?.[0]?.text_item?.text)
    }
  }
} catch (err) {
  clearTimeout(timer)
  console.error("请求失败:", err)
}
