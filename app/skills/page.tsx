/* AI start: Skills 页面 — 展示所有可用的 CodeFlicker Skills */
'use client'

import { useState, useMemo } from 'react'
import { SKILLS, SKILL_CATEGORIES, searchSkills, type Skill } from '../lib/skills-data'

// AI: 分类图标和颜色映射
const CATEGORY_STYLES: Record<Skill['category'], { bgColor: string; borderColor: string }> = {
  productivity: { bgColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' },
  development: { bgColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  integration: { bgColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)' },
  management: { bgColor: 'rgba(139, 92, 246, 0.1)', borderColor: 'rgba(139, 92, 246, 0.3)' },
}

export default function SkillsPage() {
  // AI: 搜索查询状态
  const [searchQuery, setSearchQuery] = useState('')
  // AI: 选中的分类筛选（null 表示全部）
  const [selectedCategory, setSelectedCategory] = useState<Skill['category'] | null>(null)
  // AI: 展开的 skill 详情
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  // AI: 过滤后的 skills 列表
  const filteredSkills = useMemo(() => {
    let result = SKILLS
    if (searchQuery.trim()) {
      result = searchSkills(searchQuery)
    }
    if (selectedCategory) {
      result = result.filter((s) => s.category === selectedCategory)
    }
    return result
  }, [searchQuery, selectedCategory])

  return (
    <div className="p-8 max-w-6xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight flex items-center gap-3">
          <span className="text-2xl">⚡</span>
          Skills
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          探索 CodeFlicker 的技能模块，扩展 AI 助手的能力
        </p>
      </div>

      {/* 搜索和筛选区域 */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        {/* AI: 搜索框 */}
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">🔍</span>
          <input
            type="text"
            placeholder="搜索 skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>

        {/* AI: 分类筛选按钮组 */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className="px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: selectedCategory === null ? 'var(--color-accent)' : 'var(--color-surface)',
              color: selectedCategory === null ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            全部
          </button>
          {SKILL_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setSelectedCategory(cat.key)}
              className="px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5"
              style={{
                background: selectedCategory === cat.key ? 'var(--color-accent)' : 'var(--color-surface)',
                color: selectedCategory === cat.key ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Skills 卡片网格 */}
      {filteredSkills.length === 0 ? (
        <div className="border border-dashed border-border-subtle rounded-lg p-10 text-center">
          <p className="text-text-muted text-sm">没有找到匹配的 skills</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => {
            const isExpanded = expandedSkill === skill.id
            const categoryStyle = CATEGORY_STYLES[skill.category]

            return (
              <div
                key={skill.id}
                className="border rounded-lg overflow-hidden transition-all cursor-pointer"
                style={{
                  background: 'var(--color-surface)',
                  borderColor: isExpanded ? 'var(--color-accent)' : 'var(--color-border)',
                }}
                onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
              >
                {/* AI: 卡片头部 */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: categoryStyle.bgColor,
                          border: `1px solid ${categoryStyle.borderColor}`,
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {SKILL_CATEGORIES.find((c) => c.key === skill.category)?.label}
                      </span>
                      {skill.source === 'internal' && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: 'var(--color-accent-subtle)',
                            color: 'var(--color-accent)',
                          }}
                        >
                          内置
                        </span>
                      )}
                    </div>
                    <span
                      className="text-xs transition-transform"
                      style={{
                        color: 'var(--color-text-muted)',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      ▾
                    </span>
                  </div>

                  {/* AI: Skill 名称和描述 */}
                  <h3 className="text-base font-medium text-text-primary mb-1">{skill.name}</h3>
                  <p
                    className="text-sm text-text-muted leading-relaxed"
                    style={{
                      display: isExpanded ? 'block' : '-webkit-box',
                      WebkitLineClamp: isExpanded ? 'unset' : 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: isExpanded ? 'visible' : 'hidden',
                    }}
                  >
                    {skill.description}
                  </p>
                </div>

                {/* AI: 展开的详情区域 */}
                {isExpanded && (
                  <div
                    className="px-4 pb-4 pt-2"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <div className="mb-3">
                      <div className="text-xs text-text-muted mb-1.5 uppercase tracking-wider">
                        触发关键词
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {skill.triggers.slice(0, 5).map((trigger) => (
                          <span
                            key={trigger}
                            className="text-xs px-2 py-1 rounded font-mono"
                            style={{
                              background: 'var(--color-surface-elevated)',
                              color: 'var(--color-text-secondary)',
                              border: '1px solid var(--color-border-subtle)',
                            }}
                          >
                            {trigger}
                          </span>
                        ))}
                        {skill.triggers.length > 5 && (
                          <span className="text-xs text-text-muted">
                            +{skill.triggers.length - 5} 更多
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: skill.userInvocable ? 'var(--color-status-done)' : 'var(--color-text-muted)',
                        }}
                      />
                      <span>{skill.userInvocable ? '可手动调用' : '自动触发'}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 底部说明 */}
      <div className="mt-8 p-4 rounded-lg text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="text-text-muted">
          💡 <strong className="text-text-secondary">提示：</strong>
          在对话中使用触发关键词即可激活对应的 skill，也可以直接说「帮我...」来让 AI 自动匹配合适的 skill。
        </p>
      </div>
    </div>
  )
}
/* AI end: Skills 页面结束 */
