import { memo } from 'react'
import type { AgentEntry } from '../utils/types'

// 快捷能力标签
export const CAPABILITY_TAGS = [
  { icon: '📄', label: '文档处理' },
  { icon: '🎬', label: '视频生成' },
  { icon: '🔍', label: '深度研究' },
  { icon: '$', label: '金融服务' },
  { icon: '📊', label: '数据分析' },
  { icon: '📈', label: '数据可视化' },
  { icon: '🖥', label: '幻灯片' },
  { icon: '📁', label: '产品管理' },
  { icon: '🎨', label: '图像设计' },
  { icon: '💻', label: '代码开发' },
]

export const WelcomeScreen = memo(function WelcomeScreen({
  agentName,
  agents,
  onAgentChange,
  onTagClick,
}: {
  agentName: string
  agents: AgentEntry[]
  onAgentChange: (name: string) => void
  onTagClick: (label: string) => void
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px 20px', minHeight: 0 }}>
      {/* 蝠鲼图标 */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ width: '160px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* SVG 动漫风蝠鲼 — 仰视角，右翼上翻，嘴大张，带海浪 */}
          <svg width="160" height="130" viewBox="0 0 160 130" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.85 }}>
            {/* ── 海浪（底部）── */}
            <path d="M0 114 C22 107, 40 121, 62 114 C84 107, 104 121, 130 114 C142 110, 152 117, 160 114" stroke="currentColor" strokeWidth="1.4" opacity="0.35" fill="none" strokeLinecap="round" />
            <path d="M0 123 C18 117, 34 128, 55 122 C66 119, 72 124, 80 121 C96 116, 118 127, 140 121 C150 118, 156 124, 160 122" stroke="currentColor" strokeWidth="1.8" opacity="0.5" fill="none" strokeLinecap="round" />
            {/* ── 身体主轮廓（仰视，菱形腹面）── */}
            <path d="M80 38 C92 42, 102 52, 104 64 C106 76, 98 86, 82 90 C66 94, 52 88, 46 76 C40 64, 46 50, 58 44 C64 41, 72 38, 80 38Z" stroke="currentColor" strokeWidth="1.8" fill="none" />
            {/* ── 右翼（向右上大幅翻卷，动感强）── */}
            <path d="M100 52 C114 40, 130 24, 148 14 C153 11, 156 15, 152 20 C140 34, 120 48, 108 58" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M104 68 C118 62, 136 54, 148 46 C152 44, 153 48, 150 52 C138 62, 118 70, 104 72" stroke="currentColor" strokeWidth="1.3" opacity="0.55" fill="none" strokeLinecap="round" />
            {/* ── 左翼（平展向左，略向上）── */}
            <path d="M56 50 C42 44, 24 38, 8 36 C4 35, 4 39, 8 42 C22 48, 42 54, 56 58" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M50 70 C36 66, 20 62, 8 60 C4 59, 4 63, 8 65 C20 68, 36 72, 50 74" stroke="currentColor" strokeWidth="1.3" opacity="0.55" fill="none" strokeLinecap="round" />
            {/* ── 头鳍（两根标志性卷角，向前张开）── */}
            <path d="M66 42 C60 32, 56 22, 58 14 C59 10, 63 11, 64 16 C65 22, 66 32, 68 40" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <path d="M92 44 C98 34, 102 22, 100 14 C99 10, 95 11, 94 16 C93 22, 91 32, 90 42" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            {/* ── 嘴巴大张（半圆形，仰视看到内部）── */}
            <path d="M64 72 C66 80, 72 84, 80 84 C88 84, 94 80, 96 72" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M64 72 C68 68, 74 66, 80 66 C86 66, 92 68, 96 72" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <path d="M68 76 C72 80, 78 82, 80 82 C82 82, 88 80, 92 76" stroke="currentColor" strokeWidth="0.9" opacity="0.4" fill="none" strokeLinecap="round" />
            {/* ── 眼睛（腹面两侧，偏上）── */}
            <circle cx="66" cy="58" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <circle cx="66" cy="58" r="1.2" fill="currentColor" />
            <circle cx="94" cy="58" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <circle cx="94" cy="58" r="1.2" fill="currentColor" />
            <circle cx="67" cy="57" r="0.7" fill="currentColor" opacity="0.5" />
            <circle cx="95" cy="57" r="0.7" fill="currentColor" opacity="0.5" />
            {/* ── 尾巴（向左下细长甩出）── */}
            <path d="M50 80 C40 88, 28 96, 18 104 C14 107, 12 104, 16 101 C24 96, 36 88, 46 80" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            {/* ── 腹面纹路（中线 + 弧线）── */}
            <path d="M80 42 L80 86" stroke="currentColor" strokeWidth="0.8" opacity="0.2" strokeLinecap="round" />
            <path d="M60 56 C68 60, 74 62, 80 62 C86 62, 92 60, 100 56" stroke="currentColor" strokeWidth="0.8" opacity="0.2" fill="none" />
            {/* ── 水花（从身体周围溅起）── */}
            <path d="M106 74 C110 68, 114 66, 114 72" stroke="currentColor" strokeWidth="1" opacity="0.4" fill="none" strokeLinecap="round" />
            <path d="M112 80 C118 76, 122 76, 120 82" stroke="currentColor" strokeWidth="0.9" opacity="0.35" fill="none" strokeLinecap="round" />
            <path d="M44 76 C40 70, 36 70, 38 76" stroke="currentColor" strokeWidth="1" opacity="0.4" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* 标题 */}
      <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '8px', letterSpacing: '-0.02em', textAlign: 'center', lineHeight: 1.3 }}>
        Claw Your Ideas Into Reality
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-text-muted)', marginBottom: '40px', textAlign: 'center', lineHeight: 1.5 }}>
        Triggered Anywhere, Completed Locally
      </p>
    </div>
  )
})
