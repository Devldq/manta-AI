/// <reference types="vite/client" />

interface Window {
  mantaDesktop?: {
    storage: {
      invoke(request: import('@manta/shared').StorageIpcRequest): Promise<import('@manta/shared').StorageIpcResponse>
      subscribeProgress(callback: (progress: import('@manta/shared').StorageOperationProgress) => void): () => void
    }
  }
}

declare module '@design/theme-presets.json' {
  const value: any
  export default value
}
