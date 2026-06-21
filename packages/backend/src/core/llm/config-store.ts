/* LLM 配置持久化存储 — ~/manta-data/llm-profiles.json（多模型配置） */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { LLMConfig, ModelProfile, LLMProfilesConfig } from './types'
import { getDefaultLLMConfig, profileToLLMConfig } from './types'

// 配置文件路径
const DATA_DIR = path.join(os.homedir(), '.manta-data')
const PROFILES_FILE = path.join(DATA_DIR, 'llm-profiles.json')
const LEGACY_FILE = path.join(DATA_DIR, 'llm-config.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/** 安全写文件（先写 tmp 再 rename） */
function safeWrite(filePath: string, data: unknown): void {
  ensureDir()
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

/** 从旧格式（单一 LLMConfig）迁移为新格式（LLMProfilesConfig） */
function migrateLegacyConfig(legacy: LLMConfig): LLMProfilesConfig {
  const id = uuidv4()
  return {
    profiles: [{
      id,
      name: `${legacy.model}`,
      isDefault: true,
      ...legacy,
    }],
    activeProfileId: id,
  }
}

/** 读取旧格式配置文件（用于自动迁移） */
function readLegacyConfig(): LLMConfig | null {
  try {
    if (fs.existsSync(LEGACY_FILE)) {
      const raw = fs.readFileSync(LEGACY_FILE, 'utf-8')
      return JSON.parse(raw) as LLMConfig
    }
  } catch {
    // 读取失败忽略
  }
  return null
}

/** 尝试从旧配置文件迁移到新格式 */
function tryMigrateLegacy(): void {
  const legacy = readLegacyConfig()
  if (legacy) {
    const migrated = migrateLegacyConfig(legacy)
    safeWrite(PROFILES_FILE, migrated)
    // 迁移完成后删除旧文件
    try {
      fs.unlinkSync(LEGACY_FILE)
    } catch {
      // 删除失败不影响功能
    }
  }
}

/** 确保至少有一个默认配置（基于环境变量） */
function createDefaultFromEnv(): LLMProfilesConfig {
  const envConfig = getDefaultLLMConfig()
  const id = uuidv4()
  return {
    profiles: [{
      id,
      name: envConfig.model,
      isDefault: true,
      ...envConfig,
    }],
    activeProfileId: id,
  }
}

// ─── 读取 ───

// 迁移是否已完成的标记（避免每次读取都重新迁移）
let migrationDone = false

/** 读取多模型配置列表 */
export function getLLMProfiles(): LLMProfilesConfig {
  // 1. 尝试自动迁移旧格式（仅执行一次）
  if (!migrationDone) {
    tryMigrateLegacy()
    migrationDone = true
  }

  // 2. 读取新格式
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const raw = fs.readFileSync(PROFILES_FILE, 'utf-8')
      const parsed = JSON.parse(raw)

      // 判断是否为旧格式（没有 profiles 字段）
      if (parsed && typeof parsed === 'object' && !('profiles' in parsed)) {
        const migrated = migrateLegacyConfig(parsed as LLMConfig)
        safeWrite(PROFILES_FILE, migrated)
        return migrated
      }

      const config = parsed as LLMProfilesConfig
      if (config.profiles && config.profiles.length > 0) {
        return config
      }
    }
  } catch {
    // 读取失败则使用默认值
  }

  // 3. 无配置文件，从环境变量创建默认配置
  const defaultConfig = createDefaultFromEnv()
  safeWrite(PROFILES_FILE, defaultConfig)
  return defaultConfig
}

/** 保存多模型配置列表 */
export function saveLLMProfiles(config: LLMProfilesConfig): void {
  safeWrite(PROFILES_FILE, config)
}

// ─── 激活配置 ───

/** 获取当前激活的 Profile */
export function getActiveProfile(): ModelProfile {
  const profilesConfig = getLLMProfiles()
  const { profiles, activeProfileId } = profilesConfig

  // 优先使用 activeProfileId
  if (activeProfileId) {
    const found = profiles.find((p) => p.id === activeProfileId)
    if (found) return found
  }

  // 其次使用 isDefault
  const defaultProfile = profiles.find((p) => p.isDefault)
  if (defaultProfile) return defaultProfile

  // 最后使用第一个
  return profiles[0]
}

/** 获取当前激活配置（兼容下游 LLMConfig 接口） */
export function getLLMConfig(): LLMConfig {
  return profileToLLMConfig(getActiveProfile())
}

/** 切换激活配置 */
export function setActiveProfile(id: string): void {
  const profilesConfig = getLLMProfiles()
  const found = profilesConfig.profiles.find((p) => p.id === id)
  if (!found) throw new Error(`找不到配置: ${id}`)
  profilesConfig.activeProfileId = id
  saveLLMProfiles(profilesConfig)
}

// ─── Profile CRUD ───

/** 添加新的模型配置 */
export function addProfile(profile: Omit<ModelProfile, 'id'>): ModelProfile {
  const profilesConfig = getLLMProfiles()
  const newProfile: ModelProfile = { ...profile, id: uuidv4() }

  // 如果是第一个配置，自动设为 default 和 active
  if (profilesConfig.profiles.length === 0) {
    newProfile.isDefault = true
    profilesConfig.activeProfileId = newProfile.id
  }

  // 如果声明为 default，需要取消其他配置的 isDefault
  if (newProfile.isDefault) {
    profilesConfig.profiles.forEach((p) => { p.isDefault = false })
  }

  profilesConfig.profiles.push(newProfile)
  saveLLMProfiles(profilesConfig)
  return newProfile
}

/** 更新已有的模型配置 */
export function updateProfile(id: string, updates: Partial<Omit<ModelProfile, 'id'>>): ModelProfile {
  const profilesConfig = getLLMProfiles()
  const index = profilesConfig.profiles.findIndex((p) => p.id === id)
  if (index === -1) throw new Error(`找不到配置: ${id}`)

  const updated = { ...profilesConfig.profiles[index], ...updates }

  // 如果声明为 default，需要取消其他配置的 isDefault
  if (updates.isDefault) {
    profilesConfig.profiles.forEach((p) => { p.isDefault = false })
    updated.isDefault = true
  }

  profilesConfig.profiles[index] = updated
  saveLLMProfiles(profilesConfig)
  return updated
}

/** 删除模型配置（不允许删除最后一个） */
export function deleteProfile(id: string): void {
  const profilesConfig = getLLMProfiles()
  if (profilesConfig.profiles.length <= 1) {
    throw new Error('至少保留一个模型配置')
  }

  const index = profilesConfig.profiles.findIndex((p) => p.id === id)
  if (index === -1) throw new Error(`找不到配置: ${id}`)

  const deleted = profilesConfig.profiles[index]
  profilesConfig.profiles.splice(index, 1)

  // 如果删除的是 active，切换到 default 或第一个
  if (profilesConfig.activeProfileId === id) {
    const defaultProfile = profilesConfig.profiles.find((p) => p.isDefault)
    profilesConfig.activeProfileId = defaultProfile?.id ?? profilesConfig.profiles[0]?.id
  }

  // 如果删除的是 default，将第一个设为 default
  if (deleted.isDefault && profilesConfig.profiles.length > 0) {
    profilesConfig.profiles[0].isDefault = true
  }

  saveLLMProfiles(profilesConfig)
}

/** 设置某个配置为默认 */
export function setDefaultProfile(id: string): void {
  const profilesConfig = getLLMProfiles()
  const found = profilesConfig.profiles.find((p) => p.id === id)
  if (!found) throw new Error(`找不到配置: ${id}`)

  profilesConfig.profiles.forEach((p) => { p.isDefault = false })
  found.isDefault = true
  saveLLMProfiles(profilesConfig)
}

// ─── 脱敏 ───

/** 返回脱敏后的多配置列表 */
export function getLLMProfilesMasked(): LLMProfilesConfig & { profilesMasked: Array<ModelProfile & { apiKeyMasked?: string }> } {
  const config = getLLMProfiles()
  const profilesMasked = config.profiles.map((profile) => {
    const masked = { ...profile }
    if (profile.apiKey && profile.apiKey.length > 8) {
      masked.apiKey = undefined
      return {
        ...masked,
        apiKeyMasked: `${profile.apiKey.slice(0, 4)}****${profile.apiKey.slice(-4)}`,
      }
    }
    return { ...masked, apiKey: profile.apiKey ? '****' : undefined, apiKeyMasked: undefined }
  })

  return {
    ...config,
    profilesMasked,
  }
}

/** 返回脱敏后的单一配置（兼容旧接口） */
export function getLLMConfigMasked(): LLMConfig & { apiKeyMasked?: string } {
  const profile = getActiveProfile()
  const config = profileToLLMConfig(profile)
  const masked = { ...config }
  if (config.apiKey && config.apiKey.length > 8) {
    masked.apiKey = undefined
    return {
      ...masked,
      apiKeyMasked: `${config.apiKey.slice(0, 4)}****${config.apiKey.slice(-4)}`,
    }
  }
  return { ...masked, apiKey: config.apiKey ? '****' : undefined }
}