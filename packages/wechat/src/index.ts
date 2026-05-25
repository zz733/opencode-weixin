#!/usr/bin/env bun
/**
 * OpenCode 微信机器人主入口
 * 负责启动 opencode 服务、连接微信、处理消息循环。
 */

import { createOpencode } from "@opencode-ai/sdk"
import * as WeixinBot from "./api"
import type { WeixinAccount } from "./api"
import {
  MessageItemType,
  type WeixinMessage,
} from "./types"
import { handleCommand, type CommandResult } from "./commands"
import {
  getContextToken,
  getPendingAction,
  getUserPreferences,
  saveContextToken,
  setPendingAction,
  setUserPreference,
} from "./state"

/** 消息去重：记录已处理的消息 ID */
const processedMessages = new Set<number>()
function isMessageProcessed(msgId: number): boolean {
  return processedMessages.has(msgId)
}
function markMessageProcessed(msgId: number): void {
  processedMessages.add(msgId)
  // 限制 Set 大小，防止内存泄漏
  if (processedMessages.size > 1000) {
    const first = processedMessages.values().next().value
    if (first !== undefined) processedMessages.delete(first)
  }
}

/** 从消息中提取内容（文本或语音转文字） */
function extractContent(msg: WeixinMessage): { text: string; hasMedia: boolean } | undefined {
  if (!msg.item_list?.length) return

  for (const item of msg.item_list) {
    // 文本消息
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return { text: String(item.text_item.text), hasMedia: false }
    }
    // 语音消息 - 优先使用语音转文字结果
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return { text: `[语音转文字] ${item.voice_item.text}`, hasMedia: true }
    }
    // 语音消息无文字时
    if (item.type === MessageItemType.VOICE) {
      return { text: "[语音消息]", hasMedia: true }
    }
    // 图片消息
    if (item.type === MessageItemType.IMAGE) {
      return { text: "[图片消息]", hasMedia: true }
    }
    // 文件消息
    if (item.type === MessageItemType.FILE && item.file_item?.file_name) {
      return { text: `[文件: ${item.file_item.file_name}]`, hasMedia: true }
    }
    // 视频消息
    if (item.type === MessageItemType.VIDEO) {
      return { text: "[视频消息]", hasMedia: true }
    }
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
  console.log(`准备发送微信消息: to=${to}, text长度=${text.length}`)
  
  const maxLen = 1500

  if (text.length <= maxLen) {
    console.log(`调用 WeixinBot.sendText...`)
    const resp = await WeixinBot.sendText({ to, text, baseUrl, token, contextToken })
    console.log(`微信消息发送完成, API响应:`, resp?.slice(0, 200))
    return
  }

  // 长消息分段发送
  console.log(`长消息，分段发送...`)
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
    await WeixinBot.sendText({ to, text: chunk, baseUrl, token, contextToken })
  }
  console.log(`微信消息分段发送完成`)
}

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

  console.log("\n开始监听微信消息...")

  // 长轮询获取消息
  let getUpdatesBuf = ""

  while (true) {
    try {
      const updates = await WeixinBot.getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: 30000,
      })

      if (!updates?.msgs?.length) {
        // 更新 buf 用于下次轮询
        if (updates?.get_updates_buf) {
          getUpdatesBuf = updates.get_updates_buf
        }
        continue
      }

      // 保存最新的 get_updates_buf
      if (updates.get_updates_buf) {
        getUpdatesBuf = updates.get_updates_buf
      }

      for (const msg of updates.msgs) {
        // 只处理来自用户的文本/语音/图片消息
        if (msg.from_user_id?.endsWith("@im.wechat")) {
          await processMessage(msg, account, opencode, sessions)
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
) {
  const userId = msg.from_user_id
  if (!userId) return

  // 消息去重
  if (msg.message_id !== undefined) {
    if (isMessageProcessed(msg.message_id)) {
      return
    }
    markMessageProcessed(msg.message_id)
  }

  console.log(`收到消息 from=${userId}: ${msg.item_list?.[0]?.text_item?.text ?? "[非文本]"}`)

  // 获取或创建会话
  let session = sessions.get(userId)
  if (!session) {
    // 先尝试获取最后一次会话
    try {
      const sessionsResp = await opencode.client.session.list()
      const existingSessions = sessionsResp.data ?? []
      
      if (existingSessions.length > 0) {
        // 使用最新的会话（按更新时间排序，取最后一个）
        const lastSession = existingSessions.sort((a: any, b: any) => 
          (b.time?.updated ?? 0) - (a.time?.updated ?? 0)
        )[0]
        
        if (lastSession) {
          session = { sessionId: lastSession.id, userId }
          sessions.set(userId, session)
          console.log(`使用已有会话: ${session.sessionId} (${lastSession.title || lastSession.id})`)
        }
      }
    } catch (err) {
      console.error("获取会话列表失败:", err)
    }
    
    // 如果没有找到会话，创建新会话
    if (!session) {
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
  }

  // 提取消息内容
  const content = extractContent(msg)
  if (!content) return

  const text = content.text.trim()
  if (!text) return

  // 检查是否有待处理的交互操作（选择模型/Agent）
  const pending = getPendingAction(userId)
  if (pending) {
    const selResult = await handleCommand(
      { userId, account, sessionId: session.sessionId, msg, opencode },
      "select",
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
      // 如果命令返回了新的会话ID，更新 sessions Map
      if (cmdResult.newSessionId) {
        session = { sessionId: cmdResult.newSessionId, userId }
        sessions.set(userId, session)
      }
      
      await sendTextMessage({
        to: userId,
        text: cmdResult.response ?? "",
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken: msg.context_token ?? "",
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
        return
      }
    }
  }

  // 构建 prompt body，注入用户的模型/Agent 偏好
  const prefs = getUserPreferences(userId)
  console.log(`用户偏好: model=${JSON.stringify(prefs.model)}, agent=${prefs.agent}`)
  
  const promptBody: any = { parts: [{ type: "text", text }] }
  if (prefs.model) {
    promptBody.model = prefs.model
  }
  if (prefs.agent) {
    promptBody.agent = prefs.agent
  }

  console.log(`发送prompt到AI: sessionId=${session.sessionId}, parts=${promptBody.parts.length}`)
  
  // 普通消息，发送到 Opencode
  result = await opencode.client.session.prompt({
    path: { id: session.sessionId },
    body: promptBody,
  })
  
  console.log(`AI响应: error=${result.error ? 'yes' : 'no'}`)

  // 提取 AI 响应内容
  const response = result.data
  console.log(`响应数据:`, JSON.stringify(response, null, 2).slice(0, 1000))
  
  // 尝试多种可能的响应格式
  const textParts = response.parts
    ?.filter((p: any) => p.type === "text")
    .map((p: any) => p.text) ?? []
  
  console.log(`textParts数量: ${textParts.length}`)
  console.log(`textParts内容:`, textParts)
  
  const responseText =
    response.info?.content ||
    response.content ||
    textParts.join("\n") ||
    response.message ||
    response.text ||
    ""

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
          contextToken: msg.context_token,
        })
        return
      } catch (err) {
        console.log(`重试过程异常:`, err)
        await sendTextMessage({
          to: userId,
          text: `AI处理失败: ${errorMessage}`,
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken: msg.context_token,
        })
        return
      }
    }
    
    await sendTextMessage({
      to: userId,
      text: `AI处理失败: ${errorMessage}`,
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: msg.context_token,
    })
    return
  }

  console.log(`响应文本长度: ${responseText.length}`)
  if (!responseText) {
    console.log(`响应文本为空，完整响应:`, JSON.stringify(response, null, 2).slice(0, 2000))
    return
  }

  console.log(`>>> 即将调用 sendTextMessage，文本: ${responseText.slice(0, 50)}...`)
  
  // 发送响应给微信用户
  try {
    await sendTextMessage({
      to: userId,
      text: responseText,
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: msg.context_token,
    })
    console.log(`>>> sendTextMessage 调用完成`)
  } catch (err) {
    console.error(`>>> sendTextMessage 抛出异常:`, err)
  }
}
