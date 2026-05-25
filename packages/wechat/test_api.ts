import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({ port: 0 })

// 测试 config.providers()
console.log("=== config.providers() ===")
try {
  const r1 = await client.config.providers()
  console.log(JSON.stringify(r1.data, null, 2))
} catch (e) {
  console.error("config.providers error:", e)
}

// 测试 provider.list()
console.log("\n=== provider.list() ===")
try {
  const r2 = await client.provider.list()
  // 只显示 id 和 models 的 key
  const all = r2.data.all.map((p: any) => ({
    id: p.id,
    models: p.models ? Object.keys(p.models) : [],
  }))
  console.log(JSON.stringify(all, null, 2))
} catch (e) {
  console.error("provider.list error:", e)
}

server.close()
