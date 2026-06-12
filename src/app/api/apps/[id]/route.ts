/*  App 单个操作 API — GET / PUT / DELETE / PATCH status */

import { NextRequest, NextResponse } from 'next/server'
import { getApp, updateApp, deleteApp, cloneApp, updateAppStatus } from '@/core/storage/app/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const app = getApp(id)
    if (!app) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 })
    }
    return NextResponse.json({ app })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()

    // 名称校验
    if (body.name !== undefined) {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: '应用名称不能为空' }, { status: 400 })
      }
      if (body.name.trim().length > 30) {
        return NextResponse.json({ error: '应用名称不能超过 30 个字符' }, { status: 400 })
      }
      body.name = body.name.trim()
    }

    // 乐观锁冲突检测
    const existing = getApp(id)
    if (!existing) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 })
    }
    if (body.version !== undefined && body.version !== existing.version) {
      return NextResponse.json(
        { error: '数据已被其他操作修改，请刷新后重试', code: 'CONCURRENT_CONFLICT' },
        { status: 409 }
      )
    }

    const { version: _, ...patch } = body
    const updated = updateApp(id, patch)
    if (!updated) {
      return NextResponse.json({ error: '更新失败' }, { status: 500 })
    }

    return NextResponse.json({ app: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const ok = deleteApp(id)
    if (!ok) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
