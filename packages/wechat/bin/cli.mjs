#!/usr/bin/env node
/**
 * OpenCode 微信机器人 - CLI 入口包装器。
 * 用于 npm 全局安装后的命令行调用。
 * 使用 bun 运行 TypeScript 源码。
 */

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve, dirname } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const entryPoint = resolve(__dirname, "../src/cli.ts")

// 传递给子进程的参数
const args = process.argv.slice(2)

// 优先使用 bun 运行，如果不可用则尝试 node + tsx
function runWithBun() {
  const child = spawn("bun", ["run", entryPoint, ...args], {
    stdio: "inherit",
    env: { ...process.env },
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}

function runWithNode() {
  const child = spawn("bunx", ["tsx", entryPoint, ...args], {
    stdio: "inherit",
    env: { ...process.env },
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}

// 检查 bun 是否可用
const { execSync } = await import("node:child_process")
try {
  execSync("which bun", { stdio: "ignore" })
  runWithBun()
} catch {
  console.warn("⚠️ 未检测到 bun，尝试使用 npx tsx 运行...")
  try {
    execSync("which npx", { stdio: "ignore" })
    runWithNode()
  } catch {
    console.error("❌ 需要安装 bun (推荐) 或 tsx 来运行此程序。")
    console.error("   安装 bun: curl -fsSL https://bun.sh/install | bash")
    process.exit(1)
  }
}
