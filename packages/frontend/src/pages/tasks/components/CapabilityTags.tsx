import { useState, useRef, memo } from 'react'
import { CAPABILITY_TAGS } from './WelcomeScreen'

export const CapabilityTags = memo(function CapabilityTags({ onSelect }: { onSelect: (label: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showRight, setShowRight] = useState(true)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  return (
    <div style={{ position: 'relative', padding: '0 20px 12px', flexShrink: 0 }}>
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        style={{ display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {CAPABILITY_TAGS.map((tag) => (
          <button
            key={tag.label}
            onClick={() => onSelect(tag.label)}
            className="transition-all duration-fast"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
              padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
              fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            <span>{tag.icon}</span>
            <span>{tag.label}</span>
          </button>
        ))}
      </div>
      {showRight && (
        <div style={{ position: 'absolute', right: '20px', top: '0', bottom: '12px', width: '48px', background: 'linear-gradient(to right, transparent, var(--color-background))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', pointerEvents: 'all', cursor: 'pointer' }}
            onClick={() => { scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' }) }}>→</span>
        </div>
      )}
    </div>
  )
})
