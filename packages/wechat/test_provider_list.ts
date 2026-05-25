import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({ port: 0 })

console.log("=== 测试 provider.list() ===")
try {
  const r = await client.provider.list()
  console.log("成功！")
  console.log("all 数量:", r.data.all.length)
  console.log("default:", JSON.stringify(r.data.default))
  console.log("connected:", r.data.connected)
  
  // 显示前3个provider的models
  for (const provider of r.data.all.slice(0, 3)) {
    console.log(`\n${provider.id}: ${Object.keys(provider.models).length} 个模型`)
    const modelIDs = Object.keys(provider.models).slice(0, 3)
    console.log("  前3个模型:", modelIDs)
  }
} catch (e: any) {
  console.error("错误:", e.message ?? e)
}

server.close()
