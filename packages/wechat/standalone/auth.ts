/**
 * 微信机器人二维码登录管理。
 * 使用官方 ilink API 进行扫码登录。
 */

import { randomUUID } from "node:crypto"
import { fetchQRCode, pollQRStatus } from "./api"

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com"

export interface WeixinAccount {
  token: string
  accountId: string
  baseUrl: string
  userId?: string
}

interface ActiveLogin {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
}

const activeLogins = new Map<string, ActiveLogin>()
const LOGIN_TTL_MS = 5 * 60_000

function isFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < LOGIN_TTL_MS
}

export type LoginStartResult = {
  qrcodeUrl?: string
  sessionKey: string
  message: string
}

export type LoginWaitResult = {
  connected: boolean
  account?: WeixinAccount
  message: string
}

/** 开始二维码登录流程 */
export async function startLogin(opts: {
  accountId?: string
  force?: boolean
}): Promise<LoginStartResult> {
  const sessionKey = opts.accountId || randomUUID()

  // 清理过期登录
  for (const [id, login] of activeLogins) {
    if (!isFresh(login)) activeLogins.delete(id)
  }

  const existing = activeLogins.get(sessionKey)
  if (!opts.force && existing && isFresh(existing) && existing.qrcodeUrl) {
    return { qrcodeUrl: existing.qrcodeUrl, sessionKey, message: "二维码已就绪，请使用微信扫描。" }
  }

  try {
    const qrResponse = await fetchQRCode({ baseUrl: DEFAULT_BASE_URL })
    const login: ActiveLogin = {
      sessionKey,
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    }
    activeLogins.set(sessionKey, login)

    return {
      qrcodeUrl: qrResponse.qrcode_img_content,
      sessionKey,
      message: "使用微信扫描以下二维码完成连接。",
    }
  } catch (err) {
    return { sessionKey, message: `获取二维码失败: ${err}` }
  }
}

/** 等待二维码扫码结果 */
export async function waitForLogin(opts: {
  sessionKey: string
  timeoutMs?: number
}): Promise<LoginWaitResult> {
  const activeLogin = activeLogins.get(opts.sessionKey)
  if (!activeLogin) {
    return { connected: false, message: "没有进行中的登录，请先发起登录。" }
  }

  if (!isFresh(activeLogin)) {
    activeLogins.delete(opts.sessionKey)
    return { connected: false, message: "二维码已过期，请重新生成。" }
  }

  const timeoutMs = opts.timeoutMs ?? 480_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const statusResponse = await pollQRStatus({
      baseUrl: DEFAULT_BASE_URL,
      qrcode: activeLogin.qrcode,
    })

    switch (statusResponse.status) {
      case "wait":
      case "scaned":
        break
      case "scaned_but_redirect":
        if (statusResponse.redirect_host) {
          // 发生 IDC 重定向，切换到新域名继续轮询
        }
        break
      case "expired":
        activeLogins.delete(opts.sessionKey)
        return { connected: false, message: "二维码已过期，请重新登录。" }
      case "confirmed":
        if (!statusResponse.ilink_bot_id) {
          return { connected: false, message: "登录失败：服务器未返回账号 ID。" }
        }
        activeLogins.delete(opts.sessionKey)

        const account: WeixinAccount = {
          token: statusResponse.bot_token ?? "",
          accountId: statusResponse.ilink_bot_id,
          baseUrl: statusResponse.baseurl || DEFAULT_BASE_URL,
          userId: statusResponse.ilink_user_id,
        }

        return { connected: true, account, message: "微信连接成功！" }
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  activeLogins.delete(opts.sessionKey)
  return { connected: false, message: "登录超时，请重试。" }
}
