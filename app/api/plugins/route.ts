/*  start: Plugins API — GET /api/plugins */
import { NextResponse } from 'next/server'
import { listPlugins } from '@/plugins/loader'

export async function GET() {
  try {
    const plugins = listPlugins()
    return NextResponse.json({ plugins })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Plugins API 结束 */
