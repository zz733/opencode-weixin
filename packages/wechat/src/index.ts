#!/usr/bin/env bun
/**
 * OpenCode 微信机器人主入口
 * 负责启动 opencode 服务、连接微信、处理消息循环。
 */

import { createOpencode } from "@opencode-ai/sdk"
import crypto from "node:crypto"
import * as WeixinBot from "./api"
import type { WeixinAccount } from "./api"
import { sendTextMessage as sendWechatText } from "./messenger"
import {
  MessageItemType,
  type WeixinMessage,
} from "./types"
import { handleCommand, handlePendingSelection, type CommandResult } from "./commands"
import {
  getContextToken,
  getPendingAction,
  getUserPreferences,
  saveContextToken,
  setPendingAction,
  setUserPreference,
} from "./state"

/** 消息去重：记录已处理的消息 ID + 时间戳 */
const processedMessages = new Map<number, number>()
function isMessageProcessed(msgId: number): boolean {
  const now = Date.now()
  const msgTime = processedMessages.get(msgId)
  // 消息 ID 在 5 秒内不重复认为是同一条消息
  if (msgTime && now - msgTime < 5000) {
    return true
  }
  return false
}
function markMessageProcessed(msgId: number): void {
  processedMessages.set(msgId, Date.now())
  // 限制 Map 大小，防止内存泄漏
  if (processedMessages.size > 1000) {
    const now = Date.now()
    for (const [id, time] of processedMessages.entries()) {
      if (now - time > 5000) {
        processedMessages.delete(id)
      }
    }
  }
}

/** 从消息中提取内容（文本或语音转文字） */
function extractContent(msg: WeixinMessage): { text: string; hasMedia: boolean; imageUrl?: string; imageAesKey?: string } | undefined {
  if (!msg.item_list?.length) return

  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return { text: String(item.text_item.text), hasMedia: false }
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return { text: `[语音转文字] ${item.voice_item.text}`, hasMedia: true }
    }
    if (item.type === MessageItemType.VOICE) {
      return { text: "[语音消息]", hasMedia: true }
    }
    if (item.type === MessageItemType.IMAGE) {
      const imageUrl = item.image_item?.media?.full_url || item.image_item?.url
      // aeskey 优先（hex编码），media.aes_key 是 base64 编码
      const imageAesKey = item.image_item?.aeskey
        ? Buffer.from(item.image_item.aeskey, "hex").toString("base64")
        : item.image_item?.media?.aes_key
      console.log(`图片消息: imageUrl=${imageUrl?.slice(0, 80)}, aesKey=${imageAesKey?.slice(0, 20)}, encrypt_type=${item.image_item?.media?.encrypt_type}`)
      return { text: "[图片消息]", hasMedia: true, imageUrl, imageAesKey }
    }
    if (item.type === MessageItemType.FILE && item.file_item?.file_name) {
      return { text: `[文件: ${item.file_item.file_name}]`, hasMedia: true }
    }
    if (item.type === MessageItemType.VIDEO) {
      return { text: "[视频消息]", hasMedia: true }
    }
  }
}

async function downloadImageAsBase64(url: string, aesKey?: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!resp.ok) {
      console.log(`图片下载失败: HTTP ${resp.status}`)
      return null
    }
    const contentType = resp.headers.get("content-type") || "image/jpeg"
    const mime = contentType.split(";")[0].trim()
    let buffer = Buffer.from(await resp.arrayBuffer())
    console.log(`图片原始大小: ${buffer.length} bytes`)

    if (buffer.length > 10 * 1024 * 1024) {
      console.log("图片太大，跳过")
      return null
    }

    if (aesKey) {
      try {
        console.log(`开始解密图片，aesKey长度: ${aesKey.length}`)
        // 微信 CDN 图片使用 AES-128-ECB 解密
        // aesKey 是 base64 编码，解码后可能是 16 字节原始密钥或 32 字节 hex 字符串
        let key = Buffer.from(aesKey, "base64")
        if (key.length === 32 && /^[0-9a-fA-F]{32}$/.test(key.toString("ascii"))) {
          key = Buffer.from(key.toString("ascii"), "hex")
        }
        console.log(`解密密钥长度: ${key.length}, 算法: aes-128-ecb`)

        const decipher = crypto.createDecipheriv("aes-128-ecb", key, null)
        const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()])
        buffer = decrypted
        console.log(`解密成功，解密后大小: ${buffer.length} bytes`)
      } catch (err) {
        console.log(`解密失败，使用原始数据: ${err}`)
      }
    } else {
      console.log("无AES密钥，使用原始数据")
    }

    return { base64: buffer.toString("base64"), mime }
  } catch (err) {
    console.log(`图片下载异常: ${err}`)
    return null
  }
}

/**
 * 解析中文语音命令。
 * 使用精确匹配/短语匹配，避免误触发。
 * 返回 null 表示不是命令，交给 AI 处理。
 */
function parseVoiceCommand(text: string): { command: string; args: string } | null {
  const normalized = text.replace(/[，。？！、\s]/g, "").trim().toLowerCase()

  // 切换模型 / 显示模型
  if (normalized === "切换模型" || normalized === "显示模型" || normalized === "模型列表") {
    return { command: "/model", args: "" }
  }
  // 切换 Agent
  if (normalized === "切换助手" || normalized === "显示助手" || normalized === "助手列表") {
    return { command: "/agent", args: "" }
  }
  // 取消
  if (normalized === "取消" || normalized === "不要了") {
    return { command: "/cancel", args: "" }
  }
  // 帮助
  if (normalized === "帮助" || normalized === "怎么用") {
    return { command: "/help", args: "" }
  }

  return null
}

/** 发送微信文本消息 */
async function sendTextMessage(params: {
  to: string
  text: string
  baseUrl: string
  token: string
  contextToken?: string
}) {
  const { to, text, baseUrl, token, contextToken } = params
  const maxLen = 1500

  if (text.length <= maxLen) {
    await sendWechatText({ to, text, baseUrl, token, contextToken })
    return
  }

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    const cut = remaining.lastIndexOf("\n", maxLen)
    const splitAt = cut > maxLen * 0.5 ? cut : maxLen
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  for (const chunk of chunks) {
    await sendWechatText({ to, text: chunk, baseUrl, token, contextToken })
  }
}

/** 每个用户的最新 contextToken，用于连续发送多个消息 */
const userContextTokens = new Map<string, string>()

/** 运行机器人 */
export async function runBot() {
  // 启动 opencode 服务
  const opencode = await createOpencode({ port: 0 })
  console.log(`Opencode 服务就绪: ${opencode.server.url}`)

  // 加载微信账号
  const account = await WeixinBot.loadAccount()
  if (!account) {
    console.error("加载微信账号失败")
    return
  }
  console.log(`✅ 已加载微信账号: ${account.accountId}`)

  // 恢复上下文 Token
  const contextToken = getContextToken()
  if (contextToken) {
    console.log(`已恢复 ${contextToken.length} 个上下文 Token`)
  }

  // 用户 -> 会话映射
  const sessions = new Map<string, { sessionId: string; userId: string }>()

  // 用户消息历史（用于上下文压缩）
  const messageHistory = new Map<string, string[]>()

  // 用户 -> typing_ticket 映射
  const typingTickets = new Map<string, string>()

  // 启动事件订阅，监听 AI 思考和工具调用
  ;(async () => {
    try {
      const events = await opencode.client.event.subscribe()
      for await (const event of events.stream) {
        if (event.type === "message.part.updated") {
          const part = event.properties.part
          const sessionId = part.sessionID
          console.log(`[事件] session=${sessionId}, part.type=${part.type}`)

          // 查找这个session对应的用户
          let targetUserId: string | undefined
          for (const [userId, session] of sessions.entries()) {
            if (session.sessionId === sessionId) {
              targetUserId = userId
              break
            }
          }

          if (!targetUserId) continue

          // 处理不同类型的 parts
          let text = ""
          switch (part.type) {
            case "tool":
              if (part.state.status === "running") {
                text = `🔧 **执行 ${part.tool}**\n`
                if (part.state.input) {
                  const inputStr = JSON.stringify(part.state.input)
                  text += `输入: ${inputStr.length > 100 ? inputStr.slice(0, 100) + "..." : inputStr}\n`
                }
              } else if (part.state.status === "completed") {
                if (part.state.title) {
                  text = `✅ **${part.state.title}**\n`
                }
                if (part.state.output) {
                  const outputStr = typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output)
                  text += `输出: ${outputStr.length > 200 ? outputStr.slice(0, 200) + "..." : outputStr}\n`
                }
              } else if (part.state.status === "error") {
                text = `❌ **工具失败** [${part.tool}]\n${part.state.error || "未知错误"}\n`
              }
              break
            default:
              break
          }

          if (text) {
            // 立即发送消息到微信
            console.log(`[立即发送] user=${targetUserId}, type=${part.type}`)
            try {
              const lastContext = userContextTokens.get(targetUserId) || ""
              const result = await sendWechatText({
                to: targetUserId,
                text: text,
                baseUrl: account.baseUrl,
                token: account.token,
                contextToken: lastContext,
              })
              if (result && result.context_token) {
                userContextTokens.set(targetUserId, result.context_token)
              }
            } catch (e) {
              console.error("发送事件消息失败:", e)
            }
          }
        }
      }
    } catch (e) {
      console.error("事件订阅失败:", e)
    }
  })()

  console.log("\n开始监听微信消息...")

  // 长轮询获取消息
  let getUpdatesBuf = ""

  while (true) {
    try {
      const updates = await WeixinBot.getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: 10000,
      })

      if (!updates?.msgs?.length) {
        if (updates?.get_updates_buf) {
          getUpdatesBuf = updates.get_updates_buf
        }
        continue
      }

      console.log(`收到 ${updates.msgs.length} 条消息`)
      for (const msg of updates.msgs) {
        console.log(`  msg: id=${msg.message_id} from=${msg.from_user_id} type=${msg.message_type} text=${msg.item_list?.[0]?.text_item?.text?.slice(0, 20)}`)
      }

      // 保存最新的 get_updates_buf
      if (updates.get_updates_buf) {
        getUpdatesBuf = updates.get_updates_buf
      }

      for (const msg of updates.msgs) {
        if (msg.from_user_id?.endsWith("@im.wechat") && msg.message_type !== 2) {
          await processMessage(msg, account, opencode, sessions, typingTickets, messageHistory)
        }
      }
    } catch (err: any) {
      // 忽略网络超时等常见错误
      const msg = err?.message ?? ""
      if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) continue
      console.error("轮询消息失败:", err)
      // 等待一段时间后重试
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

/** 处理单条消息 */
async function processMessage(
  msg: WeixinMessage,
  account: WeixinAccount,
  opencode: Awaited<ReturnType<typeof createOpencode>>,
  sessions: Map<string, { sessionId: string; userId: string }>,
  typingTickets: Map<string, string>,
  messageHistory: Map<string, string[]>,
) {
  const userId = msg.from_user_id
  if (!userId) return
  
  // 更新 contextToken 以便后续消息能正确跟进
  if (msg.context_token) {
    userContextTokens.set(userId, msg.context_token)
  }

  // 消息去重
  if (msg.message_id !== undefined) {
    if (isMessageProcessed(msg.message_id)) {
      return
    }
    markMessageProcessed(msg.message_id)
  }

  console.log(`收到消息 from=${userId}: ${msg.item_list?.[0]?.text_item?.text ?? "[非文本]"}`)

  // 获取 typing_ticket（需要用户的 contextToken）
  if (!typingTickets.has(userId) && msg.context_token) {
    try {
      const configResp = await WeixinBot.getConfig({
        baseUrl: account.baseUrl,
        token: account.token,
        ilinkUserId: userId,
        contextToken: msg.context_token,
      })
      if (configResp.typing_ticket) {
        typingTickets.set(userId, configResp.typing_ticket)
        console.log(`✅ 已获取用户 ${userId} 的 typing_ticket`)
      }
    } catch (e) {
      console.log(`获取 typing_ticket 失败:`, e)
    }
  }

  // 获取或创建会话
  let session = sessions.get(userId)
  if (!session) {
    // 创建新会话
    const createResult = await opencode.client.session.create({
      body: { title: `微信用户 ${userId}` },
    })
    if (createResult.error) {
      console.error("创建会话失败:", createResult.error)
      return
    }
    session = { sessionId: createResult.data.id, userId }
    sessions.set(userId, session)
    console.log(`创建新会话: ${session.sessionId}`)
  }

  // 提取消息内容
  const content = extractContent(msg)
  if (!content) return

  const text = content.text.trim()
  if (!text) return

  // 记录用户消息历史（用于上下文压缩）
  const history = messageHistory.get(userId) || []
  history.push(`用户: ${text}`)
  if (history.length > 10) {
    history.shift()
  }
  messageHistory.set(userId, history)

  // 检查是否有待处理的交互操作（选择模型/Agent）
  const pending = getPendingAction(userId)
  if (pending) {
    const selResult = await handlePendingSelection(
      { userId, account, sessionId: session.sessionId, msg, opencode },
      text,
    )
    if (selResult.handled) {
      await sendTextMessage({
        to: userId,
        text: selResult.response ?? "",
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken: msg.context_token ?? "",
      })
      return
    }
  }

  // 检查是否是命令（以 / 开头）或语音命令
  let result: any

  // 处理 / 命令
  if (text.startsWith("/")) {
    const parts = text.slice(1).split(/\s+/)
    const command = parts[0]?.toLowerCase()
    const args = parts.slice(1).join(" ")

    console.log(`执行命令: /${command} ${args}`)

    const cmdResult = await handleCommand(
      { userId, account, sessionId: session.sessionId, msg, opencode },
      command,
      args,
    )

    if (cmdResult.handled) {
      if (cmdResult.newSessionId) {
        session = { sessionId: cmdResult.newSessionId, userId }
        sessions.set(userId, session)
      }
      
      console.log(`[发送命令响应] text长度=${(cmdResult.response ?? "").length}`)
      await sendTextMessage({
        to: userId,
        text: cmdResult.response ?? "",
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken: msg.context_token ?? "",
      })
      console.log(`[发送命令响应完成]`)
      await sendTextMessage({
        to: userId,
        text: "✅ 当前命令执行完毕。",
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken: userContextTokens.get(userId) || msg.context_token || "",
      })
      return
    }
  } else {
    // 处理中文语音命令
    const voiceCmd = parseVoiceCommand(text)
    if (voiceCmd) {
      const cmdResult = await handleCommand(
        { userId, account, sessionId: session.sessionId, msg, opencode },
        voiceCmd.command.slice(1),
        voiceCmd.args,
      )

      if (cmdResult.handled) {
        await sendTextMessage({
          to: userId,
          text: cmdResult.response ?? "",
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: msg.context_token ?? "",
        })
        await sendTextMessage({
          to: userId,
          text: "✅ 当前命令执行完毕。",
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: userContextTokens.get(userId) || msg.context_token || "",
        })
        return
      }
    }
  }

  // 构建 prompt body，注入用户的模型/Agent 偏好
  const prefs = getUserPreferences(userId)
  console.log(`用户偏好: model=${JSON.stringify(prefs.model)}, agent=${prefs.agent}`)
  
  let promptBody: any

  // 处理图片消息
  if (content.imageUrl) {
    console.log(`下载图片: ${content.imageUrl.slice(0, 100)}...`)
    const imageData = await downloadImageAsBase64(content.imageUrl, content.imageAesKey)
    if (!imageData) {
      await sendTextMessage({
        to: userId,
        text: "❌ 图片下载失败，请重新发送。",
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken: msg.context_token ?? "",
      })
      return
    }

    console.log(`图片下载成功: mime=${imageData.mime}, size=${imageData.base64.length}`)
    const dataUrl = `data:${imageData.mime};base64,${imageData.base64}`

    promptBody = {
      parts: [
        { type: "text", text: text === "[图片消息]" ? "请描述这张图片" : text },
        { type: "file", mime: imageData.mime, url: dataUrl, filename: "image.jpg" },
      ],
    }
  } else {
    promptBody = { parts: [{ type: "text", text }] }
  }

  if (prefs.model) {
    promptBody.model = prefs.model
  }
  if (prefs.agent) {
    promptBody.agent = prefs.agent
  }

  console.log(`发送prompt到AI: sessionId=${session.sessionId}, parts=${promptBody.parts.length}`)

  // 发送「正在输入」状态
  const userTypingTicket = typingTickets.get(userId)
  if (userTypingTicket) {
    try {
      await WeixinBot.sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: userId,
          typing_ticket: userTypingTicket,
          status: 1, // 正在输入
        },
      })
      console.log(`已发送「正在输入」状态`)
    } catch (e) {
      console.log(`发送「正在输入」失败:`, e)
    }
  }

  // 普通消息，发送到 Opencode
  result = await opencode.client.session.prompt({
    path: { id: session.sessionId },
    body: promptBody,
  })
  
  console.log(`AI响应: error=${result.error ? 'yes' : 'no'}`)

  // 提取 AI 响应内容
  const response = result.data
  console.log(`响应数据:`, JSON.stringify(response, null, 2).slice(0, 2000))

  // 检查输入 tokens，如果太大则触发上下文压缩
  const inputTokens = response?.info?.tokens?.input ?? 0
  if (inputTokens > 50000) {
    console.log(`输入 tokens 过多 (${inputTokens})，开始压缩上下文...`)
    
    // 发送「正在压缩上下文」到微信
    await sendTextMessage({
      to: userId,
      text: "📝 上下文较长，正在压缩历史记录...",
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: userContextTokens.get(userId) || msg.context_token || "",
    })

    // 获取消息历史并压缩
    const history = messageHistory.get(userId) || []
    if (history.length > 0) {
      // 用 AI 压缩历史
      const summaryPrompt = `请用 50-100 字简洁概括以下对话的核心内容（需求、决策、错误等关键信��），不要细节：\n\n${history.join("\n")}`
      
      const summaryResult = await opencode.client.session.prompt({
        path: { id: session.sessionId },
        body: { parts: [{ type: "text", text: summaryPrompt }] },
      })
      
      const summaryText = (summaryResult.data?.parts?.find((p: any) => p.type === "text") as any)?.text || ""
      
      // 创建新会话，把摘要作为背景
      const createResult = await opencode.client.session.create({
        body: { title: `微信用户 ${userId}` },
      })
      
      if (!createResult.error) {
        session = { sessionId: createResult.data.id, userId }
        sessions.set(userId, session)
        
        // 发送摘要到新会话作为背景
        if (summaryText) {
          await opencode.client.session.prompt({
            path: { id: session.sessionId },
            body: { parts: [{ type: "text", text: `[上下文摘要] ${summaryText}` }] },
          })
        }
        
        // 清空历史记录
        messageHistory.set(userId, [])
        
        console.log(`上下文已压缩，新会话: ${session.sessionId}`)
        
        // 发送「压缩完成」到微信
        await sendTextMessage({
          to: userId,
          text: "✅ 上下文已压缩，继续对话~",
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: userContextTokens.get(userId) || msg.context_token || "",
        })
      }
    }
  }

  // 只提取纯文本响应内容
  function processParts(parts: any[]): string {
    const result: string[] = []
    for (const part of parts) {
      if (part.type === "text" && part.text && part.text.trim().length > 0) {
        result.push(part.text)
      }
    }
    return result.join("")
  }
  
  // 提取完整的响应内容
  let responseText = ""
  if (response.parts && response.parts.length > 0) {
    responseText = processParts(response.parts)
  }
  
  // 如果没有 parts，则尝试旧的格式
  if (!responseText || responseText.trim().length === 0) {
    responseText =
      response.info?.content ||
      response.content ||
      response.message ||
      response.text ||
      ""
  }

  // 检查是否有错误信息
  const errorMessage = response.info?.error?.data?.message
  if (errorMessage) {
    console.log(`AI返回错误: ${errorMessage}`)
    
    // 如果是图片格式错误，创建新会话并重试
    if (errorMessage.includes("image format is illegal")) {
      console.log(`图片格式错误，创建新会话重试`)
      try {
        const createResult = await opencode.client.session.create({
          body: { title: `微信用户 ${userId}` },
        })
        if (createResult.error) {
          console.log(`创建会话失败:`, createResult.error)
          await sendTextMessage({
            to: userId,
            text: `AI处理失败: ${errorMessage}`,
            baseUrl: account.baseUrl,
            token: account.token,
            contextToken: msg.context_token,
          })
          return
        }
        
        // 更新会话
        session = { sessionId: createResult.data.id, userId }
        sessions.set(userId, session)
        console.log(`创建新会话重试: ${session.sessionId}`)
        
        // 重试发送（不带图片）
        const retryBody: any = { parts: [{ type: "text", text }] }
        if (prefs.model) retryBody.model = prefs.model
        if (prefs.agent) retryBody.agent = prefs.agent
        
        console.log(`重试发送prompt: sessionId=${session.sessionId}`)
        const retryResult = await opencode.client.session.prompt({
          path: { id: session.sessionId },
          body: retryBody,
        })
        
        console.log(`重试AI响应: error=${retryResult.error ? 'yes' : 'no'}`)
        if (retryResult.error) {
          console.log(`重试失败:`, retryResult.error)
          await sendTextMessage({
            to: userId,
            text: `AI处理失败: ${errorMessage}`,
            baseUrl: account.baseUrl,
            token: account.token,
            contextToken: msg.context_token,
          })
          return
        }
        
        // 处理重试结果
        const retryResponse = retryResult.data
        console.log(`重试响应数据:`, JSON.stringify(retryResponse, null, 2).slice(0, 500))
        
        const retryText =
          retryResponse.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n") ||
          ""
        
        console.log(`重试响应文本长度: ${retryText.length}`)
        if (!retryText) {
          console.log(`重试响应为空`)
          return
        }
        
        console.log(`发送重试响应到微信`)
        await sendTextMessage({
          to: userId,
          text: retryText,
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: userContextTokens.get(userId) || msg.context_token || "",
        })
        return
      } catch (err) {
        console.log(`重试过程异常:`, err)
        await sendTextMessage({
          to: userId,
          text: `AI处理失败: ${errorMessage}`,
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: userContextTokens.get(userId) || msg.context_token || "",
        })
        return
      }
    }
    
    await sendTextMessage({
      to: userId,
      text: `AI处理失败: ${errorMessage}`,
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: userContextTokens.get(userId) || msg.context_token || "",
    })
    return
  }

  console.log(`响应文本长度: ${responseText.length}`)
  if (!responseText) {
    console.log(`响应文本为空，完整响应:`, JSON.stringify(response, null, 2).slice(0, 2000))
    // 如果没有响应文本，发送一个简单的完成提示
    await sendTextMessage({
      to: userId,
      text: "✅ 完成",
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: userContextTokens.get(userId) || msg.context_token || "",
    })
    return
  }

  // 发送响应给微信用户
  console.log(`准备发送响应到微信: userId=${userId}, text="${responseText}"`)
  try {
    const result = await sendTextMessage({
      to: userId,
      text: responseText,
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: userContextTokens.get(userId) || msg.context_token || "",
    })
    console.log(`响应发送完成:`, result)
  } catch (e) {
    console.error(`发送响应失败:`, e)
  }

  // 发送「取消输入」状态
  if (userTypingTicket) {
    try {
      await WeixinBot.sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: userId,
          typing_ticket: userTypingTicket,
          status: 2, // 取消输入
        },
      })
      console.log(`已发送「取消输入」状态`)
    } catch (e) {
      console.log(`发送「取消输入」失败:`, e)
    }
  }
}
