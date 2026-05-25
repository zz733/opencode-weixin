#!/usr/bin/env node
import { createRequire } from "node:module"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const entryPoint = resolve(__dirname, "../dist/cli.js")

const args = process.argv.slice(2)

async function main() {
  try {
    const mod = await import(entryPoint)
  } catch (err) {
    console.error("❌ 启动失败:", err)
    process.exit(1)
  }
}

main()
