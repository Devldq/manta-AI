/* AI start: 插件启用/禁用 PATCH API — PATCH /api/plugins/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { listPlugins, readDisabledSet, writeDisabledSet } from '@/plugins/loader'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pluginId } = await params
  let disabled: boolean
  try {
    const body = await req.json()
    disabled = Boolean(body.disabled)
  } catch {
    return NextResponse.json({ success: false, error: '请求体解析失败' }, { status: 400 })
  }

  // AI: 确认插件存在
  const plugins = listPlugins()
  const plugin = plugins.find((p) => p.id === pluginId)
  if (!plugin) {
    return NextResponse.json({ success: false, error: '插件不存在' }, { status: 404 })
  }

  try {
    const disabledSet = readDisabledSet()
    if (disabled) {
      disabledSet.add(pluginId)
    } else {
      disabledSet.delete(pluginId)
    }
    writeDisabledSet(disabledSet)
    return NextResponse.json({ success: true, pluginId, disabled })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
/* AI end: 插件启用/禁用 API 结束 */
