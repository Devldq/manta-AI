/* 应用详情页 — /apps/[id] (Server Component 壳) */
import { getApp } from '@/core/storage/app/store'
import { notFound } from 'next/navigation'
import AppDetailPageClient from './AppDetailPageClient'

export default async function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  // 在服务端预取数据
  const app = getApp(id)
  
  if (!app) {
    notFound()
  }

  return <AppDetailPageClient initialApp={app} />
}
