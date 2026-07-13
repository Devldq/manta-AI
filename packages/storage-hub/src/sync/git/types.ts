export type GitBindingMode = 'local' | 'remote'

/** A credential identifier owned by the platform keychain, never a credential value. */
export type CredentialRef = string

export interface GitCapability {
  available: boolean
  version?: string
  reason?: string
}

export interface GitCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface GitCommandResult {
  stdout: string
  stderr: string
}

export interface GitBinding {
  volumeId: string
  /** Relative to the current active root of volumeId; never a persisted absolute path. */
  repositoryRelativePath: string
  mode: GitBindingMode
  remoteUrl?: string
  credentialRef?: CredentialRef
  createdAt: string
  updatedAt: string
}

export interface GitCredentialInput {
  ref: CredentialRef
  /** The value is accepted only for writing directly to an OS-backed store. */
  secret: string
}

export interface CredentialStore {
  readonly available: boolean
  put(reference: CredentialRef, secret: string): Promise<void>
  get(reference: CredentialRef): Promise<string | undefined>
  remove(reference: CredentialRef): Promise<void>
}

/** Deliberately non-persistent default when no native keychain is available. */
export class UnavailableCredentialStore implements CredentialStore {
  readonly available = false
  async put(): Promise<void> { throw new Error('A secure OS credential store is unavailable') }
  async get(): Promise<undefined> { return undefined }
  async remove(): Promise<void> {}
}

/** Injectable test double; applications must supply an OS keychain-backed implementation. */
export class FakeCredentialStore implements CredentialStore {
  readonly available = true
  private readonly values = new Map<CredentialRef, string>()
  async put(reference: CredentialRef, secret: string): Promise<void> { this.values.set(reference, secret) }
  async get(reference: CredentialRef): Promise<string | undefined> { return this.values.get(reference) }
  async remove(reference: CredentialRef): Promise<void> { this.values.delete(reference) }
}
