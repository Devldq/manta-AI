/*  App API — GET 列表 / POST 创建 */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler } from '@/core/api/error-handler'
import { fetchApps, createNewApp } from '@/core/services/app.service'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.toLowerCase()
    const status = searchParams.get('status') as 'draft' | 'published' | 'archived' | null
    const sort = searchParams.get('sort') ?? 'updatedAt'

    const apps = fetchApps({
      search: search ?? undefined,
      status: status ?? undefined,
      sort,
    })

    return apiSuccess({ apps })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()
    const app = createNewApp(body)
    return { app }
  })
}
