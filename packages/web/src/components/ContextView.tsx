/* 上下文视图组件 */
import { useState } from 'react'
import { File, Folder, Search, ChevronRight, ChevronDown } from 'lucide-react'

interface ContextItem {
  id: string
  name: string
  type: 'file' | 'folder' | 'variable' | 'function'
  path?: string
  content?: string
  expanded?: boolean
  children?: ContextItem[]
}

export function ContextView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [contextItems, setContextItems] = useState<ContextItem[]>([
    {
      id: '1',
      name: 'src',
      type: 'folder',
      expanded: true,
      children: [
        { id: '1-1', name: 'app.tsx', type: 'file', path: 'src/app.tsx' },
        { id: '1-2', name: 'index.ts', type: 'file', path: 'src/index.ts' }
      ]
    },
    {
      id: '2',
      name: 'components',
      type: 'folder',
      expanded: false,
      children: [
        { id: '2-1', name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx' },
        { id: '2-2', name: 'Modal.tsx', type: 'file', path: 'src/components/Modal.tsx' }
      ]
    }
  ])

  const toggleExpand = (id: string) => {
    setContextItems(prev => toggleItemExpand(prev, id))
  }

  const toggleItemExpand = (items: ContextItem[], id: string): ContextItem[] => {
    return items.map(item => {
      if (item.id === id) {
        return { ...item, expanded: !item.expanded }
      }
      if (item.children) {
        return { ...item, children: toggleItemExpand(item.children, id) }
      }
      return item
    })
  }

  const filteredItems = searchQuery
    ? filterItems(contextItems, searchQuery)
    : contextItems

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏 */}
      <div className="p-4 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="Search context..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* 上下文列表 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-1">
          {filteredItems.map((item) => (
            <ContextItemComponent
              key={item.id}
              item={item}
              onToggle={toggleExpand}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ContextItemComponent({ item, onToggle }: {
  item: ContextItem
  onToggle: (id: string) => void
}) {
  const Icon = item.type === 'folder' ? Folder : File
  const hasChildren = item.children && item.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-elevated cursor-pointer"
        onClick={() => hasChildren && onToggle(item.id)}
      >
        {hasChildren ? (
          item.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        ) : (
          <span className="w-[14px]" />
        )}
        <Icon size={16} className="text-text-muted" />
        <span className="text-sm text-text-primary">{item.name}</span>
      </div>
      {item.expanded && item.children && (
        <div className="ml-4">
          {item.children.map((child) => (
            <ContextItemComponent
              key={child.id}
              item={child}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function filterItems(items: ContextItem[], query: string): ContextItem[] {
  return items.reduce((acc: ContextItem[], item) => {
    const matchesSearch = item.name.toLowerCase().includes(query.toLowerCase())
    const filteredChildren = item.children ? filterItems(item.children, query) : []
    
    if (matchesSearch || filteredChildren.length > 0) {
      acc.push({
        ...item,
        expanded: true,
        children: filteredChildren
      })
    }
    
    return acc
  }, [])
}
