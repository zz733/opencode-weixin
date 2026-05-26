/**
 * 微信消息发送器。
 * 处理文本和媒体消息的发送逻辑。
 */

import { randomUUID } from "node:crypto"
import { sendMessage } from "./api"
import type { MessageItem, SendMessageReq } from "./types"
import { MessageItemType, MessageState, MessageType } from "./types"

/** 将 Markdown 转为纯文本（微信不支持 Markdown） */
export function markdownToPlainText(text: string): string {
  let result = text
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim())
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  result = result.replace(/^(\|[\s:|-]+\|)$/gm, "")
  result = result.replace(/^#+\s*/gm, "")
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1")
  result = result.replace(/\*([^*]+)\*/g, "$1")
  result = result.replace(/`([^`]+)`/g, "$1")
  result = result.replace(/~~([^~]+)~~/g, "$1")
  return result.trim()
}

function generateClientId(): string {
  return `opencode-weixin-${randomUUID().slice(0, 8)}`
}

/** 构建文本消息请求 */
function buildTextMessage(params: {
  to: string
  text: string
  contextToken?: string
  clientId: string
}): SendMessageReq {
  const items: MessageItem[] = params.text
    ? [{ type: MessageItemType.TEXT, text_item: { text: params.text } }]
    : []

  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: params.clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: items.length ? items : undefined,
      context_token: params.contextToken ?? undefined,
    },
  }
}

/** 发送纯文本消息 */
export async function sendTextMessage(params: {
  to: string
  text: string
  baseUrl: string
  token?: string
  contextToken?: string
}): Promise<{ context_token?: string }> {
  const clientId = generateClientId()
  const text = markdownToPlainText(params.text)
  const req = buildTextMessage({
    to: params.to,
    text,
    contextToken: params.contextToken,
    clientId,
  })

  await sendMessage({
    baseUrl: params.baseUrl,
    token: params.token,
    body: req,
  })

  return {}
}
