#!/usr/bin/env node
/**
 * OpenCode 微信机器人 CLI 入口。
 * 支持全局安装后通过命令行直接运行。
 *
 * 使用方式：
 *   opencode-wechat              # 直接运行（需要已有账号）
 *   opencode-wechat --login      # 扫码登录微信
 *   opencode-wechat --serve      # 先启动 opencode serve
 *   opencode-wechat --url <URL>  # 连接已有服务
 *   opencode-wechat --daemon     # 后台服务模式启动
 *   opencode-wechat --stop       # 停止后台服务
 *   opencode-wechat --status     # 查看服务状态
 */

import { runBot } from "./index"
import { startLogin, waitForLogin } from "./auth"
import QRCode from "qrcode"
import type QRCodeType from "qrcode"
import fs from "node:fs"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import os from "node:os"

const CONFIG_DIR = path.join(os.homedir(), ".opencode-wechat")
const PID_FILE = path.join(CONFIG_DIR, "opencode-wechat.pid")
const LOG_FILE = path.join(CONFIG_DIR, "opencode-wechat.log")
const IS_WINDOWS = process.platform === "win32"

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function getPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null
  const pidStr = fs.readFileSync(PID_FILE, "utf-8").trim()
  const pid = parseInt(pidStr, 10)
  if (isNaN(pid)) {
    try { fs.unlinkSync(PID_FILE) } catch {}
    return null
  }
  try {
    if (IS_WINDOWS) {
      const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf-8" })
      if (result.stdout.includes(pid.toString())) return pid
    } else {
      process.kill(pid, 0)
      return pid
    }
  } catch {}
  try { fs.unlinkSync(PID_FILE) } catch {}
  return null
}

function ensureSingleInstance(): void {
  ensureConfigDir()
  const existingPid = getPid()
  if (existingPid) {
    console.error(`❌ 已有实例在运行 (PID: ${existingPid})，请先停止后再启动。`)
    console.error(`   如需强制停止，请执行: opencode-wechat --stop`)
    process.exit(1)
  }

  fs.writeFileSync(PID_FILE, String(process.pid))

  const cleanup = () => {
    try { fs.unlinkSync(PID_FILE) } catch {}
    process.exit(0)
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("exit", () => {
    try { fs.unlinkSync(PID_FILE) } catch {}
  })
}

const args = process.argv.slice(2)

let serverUrl: string | undefined
let autoServe = false
let doLogin = false
let daemonMode = false
let stopDaemon = false
let statusOnly = false
let logFile: string | undefined

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--serve":
      autoServe = true
      break
    case "--login":
      doLogin = true
      break
    case "--url":
      serverUrl = args[++i]
      break
    case "--daemon":
      daemonMode = true
      break
    case "--stop":
      stopDaemon = true
      break
    case "--status":
      statusOnly = true
      break
    case "--log":
      logFile = args[++i]
      break
    case "--help":
    case "-h":
      console.log(`
OpenCode 微信机器人

使用方式：
  opencode-wechat                   直接运行（需要已有账号）
  opencode-wechat --login           扫码登录微信账号
  opencode-wechat --serve           先启动 opencode serve，再连接
  opencode-wechat --url <URL>       连接到已有的 opencode 服务地址
  opencode-wechat --daemon [--log <file>]  后台服务模式启动
  opencode-wechat --stop            停止后台服务
  opencode-wechat --status          查看服务状态

选项：
  --login            扫码登录微信账号
  --serve            启动 opencode 服务（端口自动分配）
  --url <URL>        连接到已有的 opencode 服务地址
  --daemon           后台服务模式启动
  --stop             停止后台服务
  --status           查看服务状态
  --log <file>       指定日志文件（默认 opencode-wechat.log）
  --help, -h         显示帮助信息

环境变量：
  OPENCODE_API_KEY    opencode API 密钥（需要 --url 时使用）
`)
      process.exit(0)
  }
}

if (stopDaemon) {
  const pid = getPid()
  if (pid) {
    try {
      if (IS_WINDOWS) {
        spawnSync("taskkill", ["/F", "/PID", pid.toString()], { stdio: "ignore" })
      } else {
        process.kill(pid, "SIGTERM")
      }
      console.log(`✅ 已发送停止信号 (PID: ${pid})`)
      let waited = 0
      while (getPid() && waited < 5000) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waited += 100
      }
      if (getPid()) {
        console.log("⏳ 进程正在停止中...")
      } else {
        console.log("✅ 服务已停止")
      }
    } catch (err) {
      console.error("❌ 停止失败:", err)
      process.exit(1)
    }
  } else {
    console.log("ℹ️ 服务未运行")
  }
  process.exit(0)
}

if (statusOnly) {
  const pid = getPid()
  if (pid) {
    console.log(`✅ 服务正在运行 (PID: ${pid})`)
    console.log(`   PID 文件: ${PID_FILE}`)
    if (fs.existsSync(LOG_FILE)) {
      console.log(`   日志文件: ${LOG_FILE}`)
    }
  } else {
    console.log("❌ 服务未运行")
  }
  process.exit(0)
}

if (doLogin) {
  ensureConfigDir()
  console.log("正在获取登录二维码...")
  const result = await startLogin({ force: true })
  if (result.qrcodeUrl) {
    console.log("\n请用微信扫描以下二维码登录：")

    try {
      const qrTerminal = await QRCode.toString(result.qrcodeUrl, {
        type: "terminal",
        small: false,
        errorCorrectionLevel: "M",
        margin: 4,
      })
      const lines = qrTerminal.split("\n").filter((l: string) => l.trim())
      const termWidth = process.stdout.columns || 80
      const qrWidth = lines[0]?.length ?? 0
      const padLeft = Math.max(0, Math.floor((termWidth - qrWidth) / 2))
      const padStr = " ".repeat(padLeft)
      console.log("")
      console.log("")
      for (const line of lines) {
        console.log(padStr + line)
      }
      console.log("")
      console.log("")
    } catch {
      console.log(result.qrcodeUrl)
    }

    console.log(`二维码链接: ${result.qrcodeUrl}`)
  } else {
    console.log("\n❌ 获取二维码失败:", result.message)
    process.exit(1)
  }

  console.log("\n等待扫码确认...")
  const waitResult = await waitForLogin({ sessionKey: result.sessionKey, timeoutMs: 300000 })

  if (waitResult.connected) {
    console.log(`\n✅ 登录成功！账号已保存到 ${path.join(CONFIG_DIR, "account.json")}`)
  } else {
    console.log("\n❌ 登录失败:", waitResult.message)
    process.exit(1)
  }
} else if (daemonMode) {
  ensureConfigDir()
  const existingPid = getPid()
  if (existingPid) {
    console.error(`❌ 服务已在运行 (PID: ${existingPid})`)
    process.exit(1)
  }

  const logPath = logFile || LOG_FILE
  const out = fs.openSync(logPath, "a")
  const err = fs.openSync(logPath, "a")

  const child = spawn(process.argv[0], [process.argv[1], ...args.filter(a => a !== "--daemon" && a !== "--log" && a !== logFile)], {
    detached: true,
    stdio: ["ignore", out, err],
    cwd: process.cwd(),
    shell: IS_WINDOWS
  })

  if (IS_WINDOWS) {
    child.unref()
  }
  console.log(`✅ 服务已启动 (PID: ${child.pid})`)
  console.log(`   日志文件: ${logPath}`)
  console.log(`   查看状态: opencode-wechat --status`)
  console.log(`   停止服务: opencode-wechat --stop`)
} else {
  ensureSingleInstance()
  runBot().catch((err: unknown) => {
    console.error("❌ 机器人运行失败:", err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
