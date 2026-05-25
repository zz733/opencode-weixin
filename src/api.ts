/**
 * 微信 ilink 官方 API 客户端。
 * 端点：https://ilinkai.weixin.qq.com
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type {
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  GetConfigResp,
  SendTypingReq,
  GetUploadUrlReq,
  GetUploadUrlResp,
} from "./types"

const ILINK_APP_ID = "bot"
const CHANNEL_VERSION = "2.1.1"

/** ilink 应用客户端版本号编码：0x00MMNNPP */
function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10))
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

const CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION)

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), "utf-8").toString("base64")
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`
}

function buildCommonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(CLIENT_VERSION),
  }
}

function buildHeaders(body: string, token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...buildCommonHeaders(),
  }
}

async function apiPostFetch(params: {
  baseUrl: string
  endpoint: string
  body: string
  token?: string
  timeoutMs: number
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl)
  const url = new URL(params.endpoint, base)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: buildHeaders(params.body, params.token),
      body: params.body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const rawText = await res.text()
    if (!res.ok) throw new Error(`${params.endpoint} ${res.status}: ${rawText}`)
    return rawText
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function apiGetFetch(params: {
  baseUrl: string
  endpoint: string
  timeoutMs: number
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl)
  const url = new URL(params.endpoint, base)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: buildCommonHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const rawText = await res.text()
    if (!res.ok) throw new Error(`${params.endpoint} ${res.status}: ${rawText}`)
    return rawText
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/** 长轮询获取新消息 */
export async function getUpdates(
  params: GetUpdatesReq & {
    baseUrl: string
    token?: string
    timeoutMs?: number
  },
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? 35_000
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({ get_updates_buf: params.get_updates_buf ?? "" }),
      token: params.token,
      timeoutMs: timeout,
    })
    return JSON.parse(rawText) as GetUpdatesResp
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf }
    }
    throw err
  }
}

/** 发送消息 */
export async function sendMessage(params: {
  baseUrl: string
  token?: string
  body: SendMessageReq
  timeoutMs?: number
}): Promise<string> {
  return await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify(params.body),
    token: params.token,
    timeoutMs: params.timeoutMs ?? 15_000,
  })
}

/** 发送文本消息 */
export async function sendText(params: {
  to: string
  text: string
  baseUrl: string
  token?: string
  contextToken?: string
}): Promise<string> {
  const clientId = `opencode-weixin-${crypto.randomBytes(4).toString("hex")}`
  const body: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: params.text } }],
      context_token: params.contextToken,
    },
  }
  return await sendMessage({ baseUrl: params.baseUrl, token: params.token, body })
}

/** 获取机器人配置 */
export async function getConfig(params: {
  baseUrl: string
  token?: string
  ilinkUserId: string
  contextToken?: string
}): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
    }),
    token: params.token,
    timeoutMs: 10_000,
  })
  return JSON.parse(rawText) as GetConfigResp
}

/** 发送输入状态（正在输入/取消） */
export async function sendTyping(params: {
  baseUrl: string
  token?: string
  body: SendTypingReq
}): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify(params.body),
    token: params.token,
    timeoutMs: 10_000,
  })
}

/** 获取文件上传 URL */
export async function getUploadUrl(
  params: GetUploadUrlReq & { baseUrl: string; token?: string },
): Promise<GetUploadUrlResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
    }),
    token: params.token,
    timeoutMs: 15_000,
  })
  return JSON.parse(rawText) as GetUploadUrlResp
}

/** 获取登录二维码 */
export async function fetchQRCode(params: {
  baseUrl: string
  botType?: string
  timeoutMs?: number
}): Promise<{ qrcode: string; qrcode_img_content: string }> {
  const botType = params.botType ?? "3"
  const rawText = await apiGetFetch({
    baseUrl: params.baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    timeoutMs: params.timeoutMs ?? 5_000,
  })
  return JSON.parse(rawText) as { qrcode: string; qrcode_img_content: string }
}

/** 轮询二维码状态 */
export async function pollQRStatus(params: {
  baseUrl: string
  qrcode: string
  timeoutMs?: number
}): Promise<{
  status: string
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}> {
  try {
    const rawText = await apiGetFetch({
      baseUrl: params.baseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`,
      timeoutMs: params.timeoutMs ?? 35_000,
    })
    return JSON.parse(rawText)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" }
    }
    return { status: "wait" }
  }
}

export interface WeixinAccount {
  token: string
  accountId: string
  baseUrl: string
  userId?: string
}

const ACCOUNT_FILE = path.join(process.cwd(), "wechat-account.json")

/** 保存微信账号到文件 */
export async function saveAccount(account: WeixinAccount): Promise<void> {
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2))
}

/** 加载保存的微信账号 */
export async function loadAccount(): Promise<WeixinAccount | null> {
  // 优先从环境变量读取
  const accountData = process.env.WEIXIN_ACCOUNT
  if (accountData) {
    try {
      return JSON.parse(accountData)
    } catch {
      return null
    }
  }

  // 从文件读取
  try {
    if (fs.existsSync(ACCOUNT_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"))
    }
  } catch {
    // 文件不存在或读取失败
  }

  return null
}
