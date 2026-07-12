declare global {
  interface Window {
    mantaOnboarding: {
      state(): Promise<any>
      selectParent(): Promise<any>
      initialize(id: string): Promise<any>
      quit(): Promise<void>
    }
  }
}

let selectionId = ''
const status = document.querySelector('#status')!
const confirm = document.querySelector<HTMLButtonElement>('#confirm')!

document.querySelector('#choose')!.addEventListener('click', async () => {
  const result = await window.mantaOnboarding.selectParent()
  if (!result?.ok) return
  selectionId = result.selectionId
  status.textContent = '已选择数据保存位置，确认后将创建 .manta-ai。'
  status.className = ''
  confirm.disabled = false
})
confirm.addEventListener('click', async () => {
  confirm.disabled = true
  status.textContent = '正在安全初始化…'
  const result = await window.mantaOnboarding.initialize(selectionId)
  if (!result.ok) {
    status.textContent = result.error.message
    status.className = 'error'
    confirm.disabled = false
  }
})
document.querySelector('#quit')!.addEventListener('click', () => void window.mantaOnboarding.quit())
void window.mantaOnboarding.state().then((result) => {
  if (result?.initialized) status.textContent = '存储已初始化，正在启动应用。'
})
export {}
