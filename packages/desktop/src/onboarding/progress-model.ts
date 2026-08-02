import { ONBOARDING_PROGRESS_STEPS, type OnboardingProgressEvent, type OnboardingProgressState, type OnboardingProgressStepId } from './progress-contract'

const LABELS: Record<OnboardingProgressStepId, string> = {
  'validate-parent': '验证存储位置',
  'create-volume': '创建安全存储目录',
  'create-groups': '创建 7 个数据分组',
  'write-manifest': '写入存储清单',
  'commit-bootstrap': '提交 Bootstrap 配置',
  'verify-storage': '验证目录与分组健康状态',
  'initialize-services': '初始化 Manta AI 服务',
  'start-backend': '启动 Backend 并完成健康检查',
  'open-main': '打开 Manta AI',
}

export interface OnboardingProgressRow {
  id: OnboardingProgressStepId
  label: string
  state: OnboardingProgressState
  message?: string
}

export function createProgressRows(): OnboardingProgressRow[] {
  return ONBOARDING_PROGRESS_STEPS.map((id) => ({ id, label: LABELS[id], state: 'pending' }))
}

export function applyProgressEvent(rows: OnboardingProgressRow[], event: OnboardingProgressEvent): OnboardingProgressRow[] {
  return rows.map((row) => {
    if (row.id !== event.step || row.state === 'complete' && event.state !== 'complete') return row
    return { ...row, state: event.state, message: event.state === 'failed' ? event.message ?? `${row.label}失败，请重试。` : undefined }
  })
}

export function resetProgressForRetry(rows: OnboardingProgressRow[]): OnboardingProgressRow[] {
  const failedIndex = rows.findIndex((row) => row.state === 'failed')
  if (failedIndex < 0) return rows
  return rows.map((row, index) => index < failedIndex ? row : { ...row, state: 'pending', message: undefined })
}
