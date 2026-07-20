# Agent Storage Hub troubleshooting

## Onboarding does not continue

The data directory is mandatory. Confirm it exists or can be created, is writable, is either empty or a complete active Manta AI data volume, is not inside another active volume, and has sufficient free space. Select the data directory itself rather than its parent. Quitting onboarding does not initialize or start the Backend.

## A cloud volume is offline or has conflicts

ASH treats iCloud, OneDrive, Dropbox, and mounted folders as local filesystem locations. Restore the provider or mount, make the directory readable, and let the provider finish downloading placeholders. Review conflict-copy paths shown in Storage settings before importing or synchronizing again; ASH does not resolve provider conflicts silently.

## Migration failed

A pre-commit copy or semantic validation failure leaves the active mapping unchanged. Keep both locations, free space, correct permissions, and retry from Storage settings. A post-commit health failure should restore the previous bootstrap snapshot automatically. Restart Manta once if recovery is pending; do not hand-edit `ash-bootstrap.json`, manifests, journals, or lock files.

The old volume remains a backup after a successful move. Delete it only after Storage settings reports the new path active, no operation pending, and subsequent writes verified. ASH refuses to remove an active volume.

## Git synchronization is blocked

Check that the volume has at most one binding, the cloud folder is online, no migration is active, and conflicts have been reviewed. Credentials are external references and are not copied into snapshots. A group moved into a volume joins its next snapshot; a group moved out is removed from later snapshots.

The secrets group is excluded from Git by default. Enabling it requires the native high-risk confirmation for that exact volume; a normal Git configuration confirmation cannot enable it. If you disable it, run Sync now to commit removal from the current snapshot. Active secrets remain in ASH, but any copies already committed may remain in Git history. Treat private repositories as risk reduction, not absolute safety.

## Codex import or projection failed

Run Detect and Inspect again, create a new preview, and approve that exact preview. Plans are one-use and reject stale source or target state. A failed apply records rollback evidence; use Roll back from Agent Connections. Raw MCP credential values are never accepted in portable plans.

## Collecting safe diagnostics

Record the Manta version, operating system, Storage status/error text, volume and group IDs, operation ID, and whether the path is local or cloud-backed. Do not attach the secrets group, `.env` files, Git credentials, MCP tokens, an entire `manta-ai-data` volume, or `ash-bootstrap.json`. Developers should reproduce with the commands in [ASH development and packaging](../development/agent-storage-hub.md) and include only sanitized command output.
