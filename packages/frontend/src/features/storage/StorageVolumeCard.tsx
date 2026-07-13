import { useState } from 'react'
import { GitRemoteUrlSchema, type StorageIpcRequest, type StorageVolumeRecord } from '@manta/shared'

type GitBinding = { volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; createdAt: string; updatedAt: string }

export function StorageVolumeCard({ volume, bytes = 0, files = 0, onRelocate, onOpen, disabled, git, onConfigureGit }: { volume: StorageVolumeRecord; bytes?: number; files?: number; onRelocate: () => void; onOpen: () => void; disabled: boolean; git?: { available: boolean; reason?: string; binding?: GitBinding }; onConfigureGit?: (request: Extract<StorageIpcRequest, { channel: 'storage:configure-git' }>) => Promise<void> | void }) {
  const [remoteUrl, setRemoteUrl] = useState(git?.binding?.remoteUrl ?? '')
  const [authRef, setAuthRef] = useState(git?.binding?.credentialRef ?? '')
  const [gitError, setGitError] = useState<string>()
  const [gitLoading, setGitLoading] = useState(false)
  const configure = async (mode: 'local' | 'remote') => {
    if (!onConfigureGit) return
    if (mode === 'remote' && !GitRemoteUrlSchema.safeParse(remoteUrl).success) { setGitError('Enter a credential-free HTTPS, HTTP, or SSH Git remote URL.'); return }
    if (typeof window !== 'undefined' && !window.confirm(`Configure ${mode} Git for ${volume.name}? This never stores a password or token.`)) return
    setGitLoading(true); setGitError(undefined)
    try { await onConfigureGit(mode === 'local' ? { channel: 'storage:configure-git', volumeId: volume.id, mode } : { channel: 'storage:configure-git', volumeId: volume.id, mode, remoteUrl, ...(authRef ? { authRef } : {}) }) }
    catch (error) { setGitError((error as Error).message) } finally { setGitLoading(false) }
  }
  return <article aria-label={`${volume.name} volume`} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
    <strong>{volume.name}</strong><div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{volume.parentPath}/.manta-ai</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0' }}>{bytes} bytes · {files} files</div>
    <button disabled={disabled} onClick={onOpen}>Open</button> <button disabled={disabled} onClick={onRelocate}>Migrate volume</button>
    <section aria-label={`${volume.name} Git sync`} style={{ marginTop: 10, fontSize: 12 }}>
      <div>Git: {git?.binding ? git.binding.mode : git?.available ? 'not configured' : 'unavailable'}</div>
      {git?.binding?.remoteUrl && <div style={{ overflowWrap: 'anywhere' }}>{git.binding.remoteUrl}</div>}
      {git?.binding && <div role="status">This volume is already bound to {git.binding.mode} Git. To use a different repository, create another storage volume.</div>}
      {git?.reason && <div role="status">{git.reason}</div>}
      {git?.available && onConfigureGit && <><button disabled={disabled || gitLoading} onClick={() => void configure('local')}>Configure local Git</button><div><label>Remote URL <input aria-label={`${volume.name} Git remote URL`} value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://host/owner/repository.git" /></label><label>Credential reference <input aria-label={`${volume.name} Git credential reference`} value={authRef} onChange={(event) => setAuthRef(event.target.value)} placeholder="keychain:work" /></label><button disabled={disabled || gitLoading} onClick={() => void configure('remote')}>Configure remote Git</button></div></>}
      {gitLoading && <div role="status">Configuring Git…</div>}{gitError && <div role="alert">{gitError}</div>}
    </section>
  </article>
}
