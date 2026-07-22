declare module '@manta/sdk/node' {
  export function createDesktopSessionURL(options?: { home?: string; environment?: NodeJS.ProcessEnv }): Promise<string>
  export function createLocalManta(options?: { home?: string; autoStart?: boolean; environment?: NodeJS.ProcessEnv }): Promise<{
    jobs: { list(options?: { limit?: number }): Promise<{ data: Array<{ id: string; status: string }> }> }
  }>
  export function stopLocalService(home?: string): Promise<boolean>
}
