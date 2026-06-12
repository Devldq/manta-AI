/*  App API — GET 列表 / POST 创建 */

import { NextRequest, NextResponse } from 'next/server'
import { listApps, createApp } from '@/core/storage/app/store'
import type { AppConfig } from '@/core/types'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.toLowerCase()
    const status = searchParams.get('status') as AppConfig['status'] | null
    const sort = searchParams.get('sort') ?? 'updatedAt'

    let apps = listApps()

    // 搜索过滤
    if (search) {
      apps = apps.filter(
        (a) =>
          a.name.toLowerCase().includes(search) ||
          a.description.toLowerCase().includes(search) ||
          a.tags.some((t) => t.toLowerCase().includes(search))
      )
    }

    // 状态过滤
    if (status && ['draft', 'published', 'archived'].includes(status)) {
      apps = apps.filter((a) => a.status === status)
    }

    // 排序
    if (sort === 'name') {
      apps.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === 'createdAt') {
      apps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else {
      // 默认按更新时间倒序
      apps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    }

    return NextResponse.json({ apps })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '应用名称不能为空' }, { status: 400 })
    }

    if (body.name.trim().length > 30) {
      return NextResponse.json({ error: '应用名称不能超过 30 个字符' }, { status: 400 })
    }

    const app = createApp({
      name: body.name.trim(),
      description: body.description?.trim(),
      icon: body.icon,
      tags: body.tags,
    })

    return NextResponse.json({ app }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
