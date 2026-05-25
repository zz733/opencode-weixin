#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, 'index.ts')

console.log('OpenCode 微信机器人启动中...')
console.log('需要安装 bun: https://bun.sh')
console.log()

// 尝试用 bun 运行
try {
  const child = spawn('bun', ['run', entry], {
    stdio: 'inherit',
    cwd: __dirname,
    env: process.env,
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} catch (e) {
  console.error('错误：未找到 bun')
  console.log('请先安装 bun: https://bun.sh/install')
  process.exit(1)
}
