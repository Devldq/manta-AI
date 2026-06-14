'use client'

import { useState, useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Save, X } from 'lucide-react'

interface WorkspaceConfigProps {
  workspaceId: string
  onClose: () => void
}

export function WorkspaceConfig({ workspaceId, onClose }: WorkspaceConfigProps) {
  const { items, updateWorkspace } = useWorkspaceStore()
  const workspace = items.find((w) => w.id === workspaceId)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  })

  useEffect(() => {
    if (workspace) {
      setFormData({
        name: workspace.name,
        description: workspace.description || '',
      })
    }
  }, [workspace])

  if (!workspace) {
    return <div>工作空间不存在</div>
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('工作空间名称不能为空')
      return
    }
    const updated = await updateWorkspace(workspaceId, {
      name: formData.name.trim(),
      description: formData.description.trim(),
    })
    if (updated) {
      toast.success('工作空间已更新')
      onClose()
    } else {
      toast.error('更新失败')
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>编辑工作空间</CardTitle>
            <CardDescription>修改工作空间的基本信息</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">名称</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="输入工作空间名称"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">描述</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="输入工作空间描述（可选）"
            rows={3}
          />
        </div>
        <div className="flex justify-end space-x-4">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}