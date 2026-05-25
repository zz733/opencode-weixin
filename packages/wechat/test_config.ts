import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({ port: 0 })

// 只测试 config.providers()
console.log("=== config.providers() ===")
try {
  const r1 = await client.config.providers()
  const providers = r1.data.providers
  console.log(`provider 数量: ${providers.length}`)
  for (const p of providers) {
    console.log(`  id: "${p.id}", name: "${p.name}", source: "${p.source}", models: ${p.models ? Object.keys(p.models).length : 0}`)
    if (p.models) {
      for (const modelID of Object.keys(p.models)) {
        console.log(`    - ${modelID}`)
      }
    }
  }
} catch (e: any) {
  console.error("config.providers error:", e.message ?? e)
}

server.close()
