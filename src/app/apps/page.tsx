/* 应用管理页 — /apps (Server Component 壳) */
import { fetchApps } from '@/core/services/app.service'
import AppsPageClient from './AppsPageClient'

export default async function AppsPage() {
  // 在服务端预取数据
  const apps = fetchApps({ sort: 'updatedAt' })

  return <AppsPageClient initialApps={apps} />
}
