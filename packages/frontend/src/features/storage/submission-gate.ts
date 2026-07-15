export interface SubmissionGate {
  readonly busy: boolean
  run(action: () => Promise<void>): Promise<void>
}

/**
 * Synchronously closes the gap between a click and React's next render.
 * Consumers derive disabled controls from the reported state while the gate
 * itself rejects duplicate dispatches immediately.
 */
export function createSubmissionGate(onBusyChange: (busy: boolean) => void): SubmissionGate {
  let busy = false
  return {
    get busy() { return busy },
    async run(action) {
      if (busy) return
      busy = true
      onBusyChange(true)
      try {
        await action()
      } finally {
        busy = false
        onBusyChange(false)
      }
    },
  }
}
