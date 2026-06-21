import { memo } from 'react'
import type { StepUsageData } from '../utils/types'
import { fmtTokens } from '../utils/formatters'

export const TokenBreakdown = memo(function TokenBreakdown({ steps, open, onToggle }: { steps: StepUsageData[]; open: boolean; onToggle: () => void }) {
  const stepCount = steps.length
  if (stepCount === 0) return null

  // 找出所有步骤中最高的总 token 数，用于归一化进度条宽度
  const maxTotal = Math.max(...steps.map((s) =>
    s.inputTokens + s.outputTokens + (s.cacheReadTokens ?? 0)
  ), 1)

  const totalIn = steps.reduce((a, s) => a + s.inputTokens, 0)
  const totalOut = steps.reduce((a, s) => a + s.outputTokens, 0)
  const totalCache = steps.reduce((a, s) => a + (s.cacheReadTokens ?? 0), 0)

  return (
    <div style={{ marginTop: '10px' }}>
      {/* 折叠开关 */}
      <button
        onClick={onToggle}
        className="token-toggle"
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '3px 8px', border: 'none', background: 'var(--color-surface-secondary, #f0f0f0)',
          cursor: 'pointer', borderRadius: '5px',
          color: 'var(--color-text-secondary)', fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-accent)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-secondary, #f0f0f0)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
      >
        <span style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform var(--duration-normal) var(--ease-out-quart)', fontSize: '9px', lineHeight: 1 }}>▼</span>
        Token 分析 · {stepCount} 步
        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
          in {fmtTokens(totalIn + totalCache)} out {fmtTokens(totalOut)}
        </span>
        {totalCache > 0 && (
          <span style={{ color: 'var(--color-status-done, #10b981)' }}>cache +{fmtTokens(totalCache)}</span>
        )}
      </button>

      {/* 展开后的步骤列表 */}
      {open && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {steps.map((step, i) => {
            // 该步的各类 token
            const noCache = step.noCacheTokens ?? step.inputTokens
            const cache = step.cacheReadTokens ?? 0
            const out = step.outputTokens
            const total = noCache + cache + out

            // 该步在进度条中的占比（相对于最高步）
            const ratio = maxTotal > 0 ? total / maxTotal : 0
            // 各段占比（相对于该步）
            const inPct = total > 0 ? (noCache / total) * 100 : 0
            const cachePct = total > 0 ? (cache / total) * 100 : 0
            const outPct = total > 0 ? (out / total) * 100 : 0

            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {/* 步骤标签行 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-secondary)', minWidth: '38px',
                    padding: '1px 5px', borderRadius: '3px',
                    background: 'var(--color-surface-secondary, #f0f0f0)',
                    textAlign: 'center',
                  }}>
                    S{i + 1}
                  </span>
                  {step.toolNames && step.toolNames.length > 0 && (
                    <span style={{
                      fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {step.toolNames.join(', ')}
                    </span>
                  )}
                  {/* 无工具调用时显示文本输出 */}
                  {(!step.toolNames || step.toolNames.length === 0) && (
                    <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>文本回复</span>
                  )}
                </div>

                {/* 进度条 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    flex: 1, height: '6px', borderRadius: '3px',
                    background: 'var(--color-surface-secondary, #f0f0f0)',
                    overflow: 'hidden', position: 'relative',
                    opacity: 0.25 + ratio * 0.75, // 小步略透明，形成视觉层级
                  }}>
                    {/* 输入（非缓存）段 */}
                    {inPct > 0 && (
                      <div style={{
                        position: 'absolute', left: 0, top: 0, height: '100%',
                        width: `${inPct}%`,
                        background: 'var(--color-accent, #6366f1)',
                        borderRadius: cachePct === 0 && outPct === 0 ? '3px' : '3px 0 0 3px',
                        transition: 'width 0.4s var(--ease-out-quart)',
                      }} />
                    )}
                    {/* 缓存段 */}
                    {cachePct > 0 && (
                      <div style={{
                        position: 'absolute', left: `${inPct}%`, top: 0, height: '100%',
                        width: `${cachePct}%`,
                        background: 'var(--color-status-done, #10b981)',
                        borderRadius: outPct === 0 ? '0 3px 3px 0' : '0',
                        transition: 'width 0.4s var(--ease-out-quart)',
                      }} />
                    )}
                    {/* 输出段 */}
                    {outPct > 0 && (
                      <div style={{
                        position: 'absolute', left: `${inPct + cachePct}%`, top: 0, height: '100%',
                        width: `${outPct}%`,
                        background: 'var(--color-warning, #f59e0b)',
                        borderRadius: '0 3px 3px 0',
                        transition: 'width 0.4s var(--ease-out-quart)',
                      }} />
                    )}
                  </div>
                  {/* 数字 */}
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', width: '70px', textAlign: 'right' }}>
                    {noCache > 0 && <span style={{ color: 'var(--color-accent)' }}>{fmtTokens(noCache)}</span>}
                    {cache > 0 && <span style={{ color: 'var(--color-status-done, #10b981)' }}>+{fmtTokens(cache)}</span>}
                    {out > 0 && <span style={{ color: 'var(--color-warning, #f59e0b)' }}> →{fmtTokens(out)}</span>}
                  </span>
                </div>
              </div>
            )
          })}

          {/* 图例 */}
          <div style={{ display: 'flex', gap: '14px', marginTop: '4px', fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--color-accent, #6366f1)', display: 'inline-block' }} />
              input (no-cache)
            </span>
            {totalCache > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--color-status-done, #10b981)', display: 'inline-block' }} />
                cache hit
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--color-warning, #f59e0b)', display: 'inline-block' }} />
              output
            </span>
          </div>
        </div>
      )}
    </div>
  )
})
