/**
 * 命令处理器
 */

import { sendTextMessage } from "./messenger"
import { setPendingAction, getPendingAction, clearPendingAction, setUserPreference, setUserDirectory } from "./state"
import type { WeixinAccount } from "./auth"
import type { WeixinMessage } from "./types"

export interface CommandContext {
  userId: string
  account: WeixinAccount
  sessionId: string
  msg: WeixinMessage
  opencode: any
}

export interface CommandResult {
  handled: boolean
  response?: string
  newSessionId?: string
}

/**
 * 处理待选择的交互操作
 */
export async function handlePendingSelection(ctx: CommandContext, text: string): Promise<CommandResult> {
  const pending = getPendingAction(ctx.userId)
  if (!pending) return { handled: false }

  const num = parseInt(text.trim(), 10)

  // 输入 0 取消选择
  if (num === 0) {
    clearPendingAction(ctx.userId)
    return { handled: true, response: "✅ 已取消选择" }
  }

  // 选择供应商后，显示该供应商的模型列表
  if (pending.type === "select-provider") {
    if (isNaN(num) || num < 1 || num > pending.providers.length) {
      return {
        handled: true,
        response: `请输入 1-${pending.providers.length} 之间的数字，或 0 取消`,
      }
    }
    const selected = pending.providers[num - 1]
    const modelIDs = Object.keys(selected.models || {})
    
    if (modelIDs.length === 0) {
      clearPendingAction(ctx.userId)
      return { handled: true, response: `供应商 ${selected.name} 暂无可用模型` }
    }

    const modelList = modelIDs.map((m, i) => `${i + 1}. ${m}`).join("\n")
    const models = modelIDs.map(m => ({ providerID: selected.id, modelID: m }))
    
    setPendingAction(ctx.userId, { type: "select-model", models })
    
    return {
      handled: true,
      response: `【${selected.name}】请选择模型（输入数字，0 取消）：\n${modelList}`,
    }
  }

  if (pending.type === "select-model") {
    if (isNaN(num) || num < 1 || num > pending.models.length) {
      return {
        handled: true,
        response: `请输入 1-${pending.models.length} 之间的数字，或 0 取消`,
      }
    }
    const selected = pending.models[num - 1]
    clearPendingAction(ctx.userId)
    setUserPreference(ctx.userId, { model: { providerID: selected.providerID, modelID: selected.modelID } })

    return {
      handled: true,
      response: `✅ 已切换模型为: ${selected.providerID}/${selected.modelID}`,
    }
  }

  if (pending.type === "select-agent") {
    if (isNaN(num) || num < 1 || num > pending.agents.length) {
      return {
        handled: true,
        response: `请输入 1-${pending.agents.length} 之间的数字，或 0 取消`,
      }
    }
    const selected = pending.agents[num - 1]
    clearPendingAction(ctx.userId)
    setUserPreference(ctx.userId, { agent: selected })

    return {
      handled: true,
      response: `✅ 已切换 Agent 为: ${selected}`,
    }
  }

  if (pending.type === "select-session") {
    if (isNaN(num) || num < 1 || num > pending.sessions.length) {
      return {
        handled: true,
        response: `请输入 1-${pending.sessions.length} 之间的数字，或 0 取消`,
      }
    }
    const selected = pending.sessions[num - 1]
    clearPendingAction(ctx.userId)

    return {
      handled: true,
      response: `✅ 已切换到会话: ${selected.title}\n目录: ${selected.directory}`,
      newSessionId: selected.id,
    }
  }

  if (pending.type === "select-project") {
    if (isNaN(num) || num < 1 || num > pending.projects.length) {
      return {
        handled: true,
        response: `请输入 1-${pending.projects.length} 之间的数字，或 0 取消`,
      }
    }
    const selected = pending.projects[num - 1]
    clearPendingAction(ctx.userId)

    // 保存用户选择的项目目录
    setUserDirectory(ctx.userId, selected.directory)

    // 创建新会话
    try {
      const createResult = await ctx.opencode.client.session.create({
        query: { directory: selected.directory },
        body: { title: `微信用户 ${ctx.userId} - ${selected.title}` },
      })
      
      if (createResult.error) {
        return {
          handled: true,
          response: `切换项目失败: ${createResult.error}`,
        }
      }

      return {
        handled: true,
        response: `✅ 已切换到项目: ${selected.title}\n目录: ${selected.directory}`,
        newSessionId: createResult.data.id,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `切换项目失败: ${err?.message ?? err}`,
      }
    }
  }

  return { handled: false }
}

/**
 * 处理命令 - 只处理 / 开头的命令
 */
export async function handleCommand(ctx: CommandContext, command: string, args: string): Promise<CommandResult> {
  const { userId, opencode } = ctx

  // /model 命令 - 支持 /model, /m, /模型
  if (command === "model" || command === "m" || command === "模型") {
    if (!args) {
      try {
        const providersResp = await opencode.client.config.providers()
        const providers = providersResp.data?.providers ?? []
        
        if (providers.length === 0) {
          return { handled: true, response: "暂无可用供应商" }
        }

        // 显示供应商列表
        const providerList = providers.map((p: any, i: number) => `${i + 1}. ${p.name || p.id} (${Object.keys(p.models || {}).length}个模型)`).join("\n")
        
        setPendingAction(userId, {
          type: "select-provider",
          providers: providers.map((p: any) => ({ id: p.id, name: p.name || p.id, models: p.models || {} })),
        })

        return {
          handled: true,
          response: `📋 请选择供应商（输入数字，0 取消）：\n${providerList}`,
        }
      } catch (err: any) {
        console.error("获取模型列表失败:", err)
        return {
          handled: true,
          response: `获取模型列表失败: ${err?.message ?? err}`,
        }
      }
    }

    const [providerID, modelID] = args.includes("/") ? args.split("/") : ["openai", args]
    setUserPreference(userId, { model: { providerID, modelID } })
    return {
      handled: true,
      response: `✅ 已切换模型为: ${providerID}/${modelID}`,
    }
  }

  // /agent 命令 - 支持 /agent, /a
  if (command === "agent" || command === "a") {
    if (!args) {
      try {
        const agentsResp = await opencode.client.app.agents()
        const agents = agentsResp.data.map((a: any) => a.name || a.id).slice(0, 20)

        if (agents.length === 0) {
          return { handled: true, response: "暂无可用 Agent" }
        }

        const agentList = agents.map((a: string, i: number) => `${i + 1}. ${a}`).join("\n")

        setPendingAction(userId, { type: "select-agent", agents })

        return {
          handled: true,
          response: `📋 请选择 Agent（输入数字，0 取消）：\n${agentList}`,
        }
      } catch (err) {
        return {
          handled: true,
          response: `获取 Agent 列表失败: ${err}`,
        }
      }
    }

    setUserPreference(userId, { agent: args })
    return {
      handled: true,
      response: `✅ 已切换 Agent 为: ${args}`,
    }
  }

  // /new 命令 - 创建新会话
  if (command === "new" || command === "n") {
    try {
      const createResult = await opencode.client.session.create({
        body: { title: `微信会话 ${new Date().toLocaleString("zh-CN")}` },
      })
      
      if (createResult.error) {
        return {
          handled: true,
          response: `创建新会话失败: ${createResult.error}`,
        }
      }

      return {
        handled: true,
        response: `✅ 已创建新会话\n会话ID: ${createResult.data.id}`,
        newSessionId: createResult.data.id,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `创建新会话失败: ${err?.message ?? err}`,
      }
    }
  }

  // /cancel 命令
  if (command === "cancel" || command === "c") {
    clearPendingAction(ctx.userId)
    return { handled: true, response: "✅ 已取消当前操作" }
  }

  // /help 命令 - 支持 /help, /h, /帮助
  if (command === "help" || command === "h" || command === "帮助") {
    return {
      handled: true,
      response: `📋 可用命令：
/new - 创建新会话
/model - 显示模型列表并选择
/model <模型名> - 直接切换模型
/agent - 显示 Agent 列表并选择
/agent <Agent名> - 直接切换 Agent
/project - 显示项目列表并选择
/dir - 显示当前目录
/cd <目录> - 切换目录
/sessions - 列出所有会话
/cancel - 取消当前操作
/help - 显示帮助信息
/list - 显示所有命令

直接发送消息即可与 AI 对话。`,
    }
  }

  // /list 命令
  if (command === "list" || command === "l") {
    return {
      handled: true,
      response: `📋 所有命令列表：

🔧 模型相关：
  /model - 显示模型列表并选择
  /m - /model 的简写
  /模型 - 中文别名

👤 Agent 相关：
  /agent - 显示 Agent 列表并选择
  /a - /agent 的简写

📁 项目/目录相关：
  /project - 显示项目列表并选择
  /p - /project 的简写
  /项目 - 中文别名
  /dir - 显示当前目录
  /cd <目录> - 切换目录
  /sessions - 列出所有会话

❌ 其他：
  /cancel 或 /c - 取消当前操作
  /help 或 /h 或 /帮助 - 显示帮助信息
  /list 或 /l - 显示所有命令

💬 直接发送消息与 AI 对话`,
    }
  }

  // /dir 命令 - 显示当前目录
  if (command === "dir" || command === "d" || command === "目录") {
    try {
      const pathInfo = await opencode.client.path.get()
      return {
        handled: true,
        response: `📁 当前目录信息：
目录: ${pathInfo.data.directory}
工作树: ${pathInfo.data.worktree}
配置: ${pathInfo.data.config}`,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `获取目录信息失败: ${err?.message ?? err}`,
      }
    }
  }

  // /sessions 命令 - 列出会话
  if (command === "sessions" || command === "s" || command === "会话") {
    try {
      const sessionsResp = await opencode.client.session.list()
      const sessions = sessionsResp.data ?? []
      
      if (sessions.length === 0) {
        return { handled: true, response: "暂无会话" }
      }

      const sessionList = sessions.slice(0, 20).map((s: any, i: number) => 
        `${i + 1}. ${s.title || s.id} (${s.directory})`
      ).join("\n")

      setPendingAction(userId, {
        type: "select-session",
        sessions: sessions.slice(0, 20).map((s: any) => ({
          id: s.id,
          title: s.title || s.id,
          directory: s.directory,
        })),
      })

      return {
        handled: true,
        response: `📋 请选择会话（输入数字，0 取消）：\n${sessionList}`,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `获取会话列表失败: ${err?.message ?? err}`,
      }
    }
  }

  // /cd 命令 - 切换目录
  if (command === "cd" || command === "切换目录") {
    if (!args) {
      return {
        handled: true,
        response: `请指定目录，例如：/cd /path/to/project`,
      }
    }
    
    try {
      // 创建新会话并指定目录
      const createResult = await opencode.client.session.create({
        query: { directory: args },
        body: { title: `微信用户 ${ctx.userId}` },
      })
      
      if (createResult.error) {
        return {
          handled: true,
          response: `切换目录失败: ${createResult.error}`,
        }
      }

      return {
        handled: true,
        response: `✅ 已切换到目录: ${args}\n新会话ID: ${createResult.data.id}`,
        newSessionId: createResult.data.id,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `切换目录失败: ${err?.message ?? err}`,
      }
    }
  }

  // 简化路径显示
  function shortenPath(path: string): string {
    const home = process.env.HOME || ""
    if (home && path.startsWith(home)) {
      return "~" + path.slice(home.length)
    }
    // 只显示最后2级目录
    const parts = path.split("/").filter(Boolean)
    if (parts.length > 2) {
      return ".../" + parts.slice(-2).join("/")
    }
    return path
  }

  // 从路径提取项目名
  function getProjectName(worktree: string): string {
    const home = process.env.HOME || ""
    let path = worktree
    if (home && path.startsWith(home)) {
      path = "~" + path.slice(home.length)
    }
    const parts = path.split("/").filter(Boolean)
    return parts[parts.length - 1] || "未命名"
  }

  // /project 命令 - 选择项目
  if (command === "project" || command === "p" || command === "项目") {
    try {
      const projectsResp = await opencode.client.project.list()
      const projects = projectsResp.data ?? []
      
      if (projects.length === 0) {
        return { handled: true, response: "暂无可用项目" }
      }

      const projectList = projects.slice(0, 20).map((p: any, i: number) => 
        `${i + 1}. ${getProjectName(p.worktree)}\n   📁 ${shortenPath(p.worktree)}`
      ).join("\n")

      setPendingAction(userId, {
        type: "select-project",
        projects: projects.slice(0, 20).map((p: any) => ({
          id: p.id,
          title: getProjectName(p.worktree),
          directory: p.worktree,
        })),
      })

      return {
        handled: true,
        response: `📋 请选择项目（输入数字，0 取消）：\n${projectList}`,
      }
    } catch (err: any) {
      return {
        handled: true,
        response: `获取项目列表失败: ${err?.message ?? err}`,
      }
    }
  }

  return { handled: false }
}