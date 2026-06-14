'use client'

import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Plus, Settings, Trash2 } from 'lucide-react'

export default function WorkspacePage() {
  const { items, loading, error, fetchList, createWorkspace, deleteWorkspace } = useWorkspaceStore()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ name: '', description: '' })

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleCreate = async () => {
    if (!newWorkspace.name.trim()) {
      toast.error('工作空间名称不能为空')
      return
    }
    const workspace = await createWorkspace({ name: newWorkspace.name.trim(), description: newWorkspace.description.trim() })
    if (workspace) {
      toast.success('工作空间创建成功')
      setIsCreateOpen(false)
      setNewWorkspace({ name: '', description: '' })
    } else {
      toast.error('创建失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此工作空间吗？')) return
    const ok = await deleteWorkspace(id)
    if (ok) {
      toast.success('工作空间已删除')
    } else {
      toast.error('删除失败')
    }
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">工作空间管理</h1>
          <p className="text-muted-foreground mt-2">
            管理您的工作空间，配置智能体应用、知识库和工作流
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新建工作空间
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建新工作空间</DialogTitle>
              <DialogDescription>
                工作空间是您组织智能体应用、知识库和工作的地方。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={newWorkspace.name}
                  onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
                  placeholder="输入工作空间名称"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={newWorkspace.description}
                  onChange={(e) => setNewWorkspace({ ...newWorkspace, description: e.target.value })}
                  placeholder="输入工作空间描述（可选）"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate}>创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading && <div className="text-center py-8">加载中...</div>}
      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((workspace) => (
          <Card key={workspace.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{workspace.name}</CardTitle>
                <div className="flex space-x-2">
                  <Button variant="ghost" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(workspace.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>{workspace.description || '暂无描述'}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                <p>创建于: {new Date(workspace.createdAt).toLocaleDateString()}</p>
                <p>更新于: {new Date(workspace.updatedAt).toLocaleDateString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {items.length === 0 && !loading && (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium">暂无工作空间</h3>
          <p className="text-muted-foreground mt-2">点击上方按钮创建您的第一个工作空间</p>
        </div>
      )}
    </div>
  )
}