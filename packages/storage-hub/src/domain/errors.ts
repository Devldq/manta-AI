export class StorageInvariantError extends Error {
  readonly code = 'STORAGE_INVARIANT_VIOLATION'

  constructor(message: string) {
    super(message)
    this.name = 'StorageInvariantError'
  }
}
