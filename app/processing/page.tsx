// AI: 处理中心已合并到任务看板，此路由重定向到看板页
import { redirect } from 'next/navigation'

export default function ProcessingPage() {
  redirect('/kanban')
}
