/* GET  /api/chat/config        — 读取多模型配置列表（apiKey 脱敏）
   PUT  /api/chat/config        — 保存完整的多模型配置列表（全量更新）
   POST /api/chat/config/test   — 测试连通性（支持 profileId 或临时配置）
   POST /api/chat/config/active — 切换激活配置 */
import { NextRequest, NextResponse } from 'next/server'
import {
 getLLMProfiles,
 getLLMProfilesMasked,
 saveLLMProfiles,
 addProfile,
 updateProfile,
 deleteProfile,
 setActiveProfile,
 setDefaultProfile,
 getLLMConfig,
 getActiveProfile,
} from '@/core/llm/config-store'
import { testLLMConnection } from '@/core/llm/factory'
import type { ModelProfile, LLMProfilesConfig } from '@/core/llm/types'
import { profileToLLMConfig } from '@/core/llm/types'
import { v4 as uuidv4 } from 'uuid'

/** GET — 读取多模型配置列表（脱敏） */
export async function GET() {
  try {
    const data = getLLMProfilesMasked()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** PUT — 保存完整的多模型配置列表 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const incoming = body as LLMProfilesConfig

    if (!incoming.profiles || incoming.profiles.length === 0) {
      return NextResponse.json({ error: 'profiles 列表不能为空' }, { status: 400 })
    }

    // apiKey 合并：如果某个 profile 的 apiKey 为空（UI 里未输入新 Key），则保留之前存储的 apiKey
    const existing = getLLMProfiles()
    incoming.profiles = incoming.profiles.map((p) => {
      if (!p.apiKey?.trim()) {
        const existingProfile = existing.profiles.find((ep) => ep.id === p.id)
        if (existingProfile) {
          return { ...p, apiKey: existingProfile.apiKey }
        }
      }
      return p
    })

    saveLLMProfiles(incoming)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — 两种用途：
 *  1. /api/chat/config?action=test — 测试连通性
 *  2. /api/chat/config?action=profile — 添加/更新/删除单个 profile
 *  3. /api/chat/config?action=active — 切换激活配置
 *  4. /api/chat/config?action=default — 设置默认配置
 */
export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action') || 'test'

    // export 不需要解析 body，直接处理
    if (action === 'export') {
      return await handleExportFull()
    }

    const body = await req.json()

    switch (action) {
      case 'test': {
        // 测试连通性：支持传入 profileId（使用已存储的配置）或临时 LLMConfig
        return await handleTest(body)
      }
      case 'profile': {
        // Profile CRUD：add / update / delete
        return await handleProfileCRUD(body)
      }
      case 'active': {
        // 切换激活配置
        return await handleSetActive(body)
      }
      case 'default': {
        // 设置默认配置
        return await handleSetDefault(body)
      }
      case 'import': {
        // 导入配置
        return await handleImport(body)
      }
      default:
        return NextResponse.json({ error: `不支持的操作: ${action}` }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

/** 测试连通性：支持 profileId 或临时配置 */
async function handleTest(body: { profileId?: string; config?: ModelProfile }) {
  let configToTest: ModelProfile

  if (body.profileId) {
    // 使用已存储的配置测试
    const profilesConfig = getLLMProfiles()
    const found = profilesConfig.profiles.find((p) => p.id === body.profileId)
    if (!found) {
      return NextResponse.json({ ok: false, error: `找不到配置: ${body.profileId}` }, { status: 404 })
    }
    configToTest = found
  } else if (body.config) {
    // 使用临时传入的配置测试
    configToTest = body.config
    // apiKey 合并：如果临时配置的 apiKey 为空，合并已存储的值
    if (!configToTest.apiKey?.trim() && configToTest.id) {
      const existing = getLLMProfiles()
      const existingProfile = existing.profiles.find((p) => p.id === configToTest.id)
      if (existingProfile) {
        configToTest = { ...configToTest, apiKey: existingProfile.apiKey }
      }
    }
  } else {
    // 使用当前激活配置测试
    configToTest = getActiveProfile()
  }

  const result = await testLLMConnection(profileToLLMConfig(configToTest))
  return NextResponse.json(result)
}

/** Profile CRUD 操作 */
async function handleProfileCRUD(body: { operation: 'add' | 'update' | 'delete'; profile?: ModelProfile; profileId?: string }) {
  switch (body.operation) {
    case 'add': {
      if (!body.profile) {
        return NextResponse.json({ error: '缺少 profile 数据' }, { status: 400 })
      }
      // apiKey 合并：如果新 profile 的 apiKey 为空，不传入（让存储层使用环境变量）
      const profileData = { ...body.profile }
      if (!profileData.apiKey?.trim()) {
        // 新增时没有 apiKey，尝试从环境变量获取
        const envConfig = getLLMConfig()
        if (envConfig.apiKey && (profileData.provider === envConfig.provider)) {
          profileData.apiKey = envConfig.apiKey
        }
      }
      const newProfile = addProfile(profileData)
      return NextResponse.json({ success: true, profile: newProfile })
    }
    case 'update': {
      if (!body.profileId || !body.profile) {
        return NextResponse.json({ error: '缺少 profileId 或 profile 数据' }, { status: 400 })
      }
      const updated = updateProfile(body.profileId, body.profile)
      return NextResponse.json({ success: true, profile: updated })
    }
    case 'delete': {
      if (!body.profileId) {
        return NextResponse.json({ error: '缺少 profileId' }, { status: 400 })
      }
      deleteProfile(body.profileId)
      return NextResponse.json({ success: true })
    }
    default:
      return NextResponse.json({ error: `不支持的操作: ${body.operation}` }, { status: 400 })
  }
}

/** 切换激活配置 */
async function handleSetActive(body: { profileId: string }) {
  if (!body.profileId) {
    return NextResponse.json({ error: '缺少 profileId' }, { status: 400 })
  }
  setActiveProfile(body.profileId)
  return NextResponse.json({ success: true })
}

/** 设置默认配置 */
async function handleSetDefault(body: { profileId: string }) {
  if (!body.profileId) {
    return NextResponse.json({ error: '缺少 profileId' }, { status: 400 })
  }
  setDefaultProfile(body.profileId)
  return NextResponse.json({ success: true })
}

/** 导入配置：合并到现有配置 */
async function handleImport(body: { profiles: ModelProfile[]; merge?: boolean }) {
  try {
    const { profiles: incomingProfiles, merge = true } = body

    if (!incomingProfiles || !Array.isArray(incomingProfiles) || incomingProfiles.length === 0) {
      return NextResponse.json({ error: 'profiles 列表不能为空' }, { status: 400 })
    }

    // 验证每个 profile 的必要字段
    for (const p of incomingProfiles) {
      if (!p.name || !p.provider || !p.model) {
        return NextResponse.json({ error: '每个配置必须包含 name、provider 和 model 字段' }, { status: 400 })
      }
    }

    const existing = getLLMProfiles()

    if (merge) {
      // 合并模式：添加新配置，如果 id 冲突则跳过或更新
      const existingIds = new Set(existing.profiles.map(p => p.id))
      let addedCount = 0
      let skippedCount = 0

      for (const p of incomingProfiles) {
        if (existingIds.has(p.id)) {
          // id 已存在，跳过（或可以选择更新，这里选择跳过）
          skippedCount++
          continue
        }
        // 确保有 id（如果没有则生成新的）
        const profileToAdd = {
          ...p,
          id: p.id || uuidv4(),
        }
        existing.profiles.push(profileToAdd)
        addedCount++
      }

      // 如果原来没有激活的配置，设置第一个为激活
      if (!existing.activeProfileId && existing.profiles.length > 0) {
        existing.activeProfileId = existing.profiles[0].id
      }

      saveLLMProfiles(existing)
      return NextResponse.json({
        success: true,
        added: addedCount,
        skipped: skippedCount,
        total: existing.profiles.length,
      })
    } else {
      // 替换模式：用导入的配置替换现有配置
      const profilesWithIds = incomingProfiles.map(p => ({
        ...p,
        id: p.id || uuidv4(),
      }))
      const newConfig: LLMProfilesConfig = {
        profiles: profilesWithIds,
        activeProfileId: profilesWithIds[0]?.id,
      }
      saveLLMProfiles(newConfig)
      return NextResponse.json({
        success: true,
        added: profilesWithIds.length,
        skipped: 0,
        total: profilesWithIds.length,
      })
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** 导出完整配置（含 apiKey） */
async function handleExportFull() {
  try {
    const data = getLLMProfiles()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}