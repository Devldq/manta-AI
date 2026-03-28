/*  start: Runner Probe API — GET /api/runners/probe */
import { NextResponse } from 'next/server'
import { probeAllRunners } from '@/core/runner'

export async function GET() {
  try {
    const results = await probeAllRunners()
    return NextResponse.json({ runners: results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Runner Probe API 结束 */
