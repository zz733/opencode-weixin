/**
 * 交互式命令状态管理
 */

// Context Token 管理
let contextToken: string | null = null

export function getContextToken(): string | null {
  return contextToken
}

export function saveContextToken(token: string) {
  contextToken = token
}

export type PendingAction =
  | { type: "select-provider"; providers: Array<{ id: string; name: string; models: Record<string, any> }> }
  | { type: "select-model"; models: Array<{ providerID: string; modelID: string }> }
  | { type: "select-agent"; agents: string[] }
  | { type: "select-session"; sessions: Array<{ id: string; title: string; directory: string }> }
  | { type: "select-project"; projects: Array<{ id: string; title: string; directory: string }> }

const pendingActions = new Map<string, PendingAction>()

export function setPendingAction(userId: string, action: PendingAction) {
  pendingActions.set(userId, action)
}

export function getPendingAction(userId: string): PendingAction | undefined {
  return pendingActions.get(userId)
}

export function clearPendingAction(userId: string) {
  pendingActions.delete(userId)
}

export function hasPendingAction(userId: string): boolean {
  return pendingActions.has(userId)
}

// 用户偏好存储（模型/Agent 等）
export interface UserPreferences {
  model?: { providerID: string; modelID: string }
  agent?: string
}

const userPrefs = new Map<string, UserPreferences>()
const userDirectories = new Map<string, string>()

export function setUserPreference(userId: string, prefs: Partial<UserPreferences>) {
  const existing = userPrefs.get(userId) ?? {}
  userPrefs.set(userId, { ...existing, ...prefs })
}

export function getUserPreferences(userId: string): UserPreferences {
  return userPrefs.get(userId) ?? {}
}

export function clearUserPreferences(userId: string) {
  userPrefs.delete(userId)
}

export function setUserDirectory(userId: string, directory: string) {
  userDirectories.set(userId, directory)
}

export function getUserDirectory(userId: string): string | undefined {
  return userDirectories.get(userId)
}

export function clearUserDirectory(userId: string) {
  userDirectories.delete(userId)
}
