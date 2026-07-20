import type { OnboardingProgressEvent } from './progress-contract'
import { applyProgressEvent, createProgressRows, resetProgressForRetry, type OnboardingProgressRow } from './progress-model'

declare global {
  interface Window {
    mantaOnboarding: {
      state(): Promise<{ ok: boolean; initialized?: boolean }>
      selectParent(): Promise<{ ok: boolean; canceled?: boolean; selectionId?: string }>
      initialize(id: string): Promise<{ ok: boolean; error?: { code: string; message: string } }>
      quit(): Promise<void>
      onProgress(listener: (event: OnboardingProgressEvent) => void): () => void
    }
  }
}

let selectionId = ''
let running = false
let rows = createProgressRows()

const status = document.querySelector<HTMLElement>('#status')!
const choose = document.querySelector<HTMLButtonElement>('#choose')!
const confirm = document.querySelector<HTMLButtonElement>('#confirm')!
const quit = document.querySelector<HTMLButtonElement>('#quit')!
const progressPanel = document.querySelector<HTMLElement>('#progress-panel')!
const progressList = document.querySelector<HTMLOListElement>('#progress-list')!

const stateSymbol: Record<OnboardingProgressRow['state'], string> = {
  pending: '·',
  active: '',
  complete: '✓',
  failed: '!',
}

function bootstrapCommitted(): boolean {
  return rows.find((row) => row.id === 'commit-bootstrap')?.state === 'complete'
}

function renderRows(): void {
  progressList.replaceChildren(...rows.map((row) => {
    const item = document.createElement('li')
    item.className = `progress-row is-${row.state}`
    item.dataset.step = row.id
    if (row.state === 'active') item.setAttribute('aria-current', 'step')

    const marker = document.createElement('span')
    marker.className = 'progress-marker'
    marker.setAttribute('aria-hidden', 'true')
    marker.textContent = stateSymbol[row.state]

    const copy = document.createElement('span')
    copy.className = 'progress-copy'
    const label = document.createElement('span')
    label.className = 'progress-label'
    label.textContent = row.label
    copy.append(label)
    if (row.message) {
      const message = document.createElement('span')
      message.className = 'progress-error'
      message.textContent = row.message
      copy.append(message)
    }
    item.append(marker, copy)
    return item
  }))
}

function setControls(): void {
  const hasFailure = rows.some((row) => row.state === 'failed')
  choose.disabled = running || bootstrapCommitted()
  confirm.disabled = running || !selectionId
  confirm.textContent = hasFailure ? '重试初始化' : '创建并启动'
  quit.disabled = running
}

function showStatus(message: string, error = false): void {
  status.textContent = message
  status.classList.toggle('error', error)
}

renderRows()
setControls()

const unsubscribe = window.mantaOnboarding.onProgress((event) => {
  rows = applyProgressEvent(rows, event)
  progressPanel.hidden = false
  renderRows()
  const row = rows.find((candidate) => candidate.id === event.step)
  if (row && event.state === 'active') showStatus(`正在${row.label}…`)
  if (row && event.state === 'failed') showStatus(event.message ?? `${row.label}失败，请重试。`, true)
  setControls()
})

choose.addEventListener('click', async () => {
  const result = await window.mantaOnboarding.selectParent()
  if (!result.ok || !result.selectionId) return
  selectionId = result.selectionId
  rows = createProgressRows()
  renderRows()
  progressPanel.hidden = true
  showStatus('已选择数据文件夹。空文件夹将用于新建数据，已有的 Manta AI 数据文件夹将直接连接。')
  setControls()
})

confirm.addEventListener('click', async () => {
  if (!selectionId || running) return
  rows = resetProgressForRetry(rows)
  renderRows()
  progressPanel.hidden = false
  running = true
  showStatus('准备初始化本地存储…')
  setControls()
  const result = await window.mantaOnboarding.initialize(selectionId)
  running = false
  if (!result.ok) showStatus(result.error?.message ?? '初始化失败，请重试。', true)
  else showStatus('初始化完成，正在打开 Manta AI。')
  setControls()
})

quit.addEventListener('click', () => void window.mantaOnboarding.quit())
window.addEventListener('beforeunload', unsubscribe)

void window.mantaOnboarding.state().then((result) => {
  if (result?.initialized) {
    progressPanel.hidden = false
    showStatus('存储已初始化，正在继续启动服务。')
  }
})

export {}
