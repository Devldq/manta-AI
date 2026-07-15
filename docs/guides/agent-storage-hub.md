# Agent Storage Hub user guide

Agent Storage Hub (ASH) keeps Manta AI's internal persistent data in user-selected storage volumes. A volume is always stored in a directory named `.manta-ai` below the parent directory you choose. Project files and explicit Agent output directories are not redirected.

## First launch

1. Select a parent directory in the required onboarding window. The choice cannot be skipped; you can quit without creating data.
2. Confirm the location. Manta creates `<parent>/.manta-ai` with all seven storage groups: extensions, knowledge, work, config, secrets, diagnostics, and cache.
3. Manta starts the backend only after the volume is initialized and healthy.

Do not select an existing active volume, a directory inside another `.manta-ai`, or a location without sufficient free space. Cloud-backed folders are ordinary local folders to ASH; the cloud provider remains responsible for network synchronization.

## Storage settings

Open Settings and select Storage to see each volume and group, its real path, file count, logical and physical size, reclaimable space, deduplication savings, migration state, Git state, and cloud-folder health.

From Storage settings you can:

- create a volume by selecting at least one group to move into it;
- move a group between volumes;
- relocate a complete volume;
- bind at most one Git repository to a volume and run or schedule synchronization;
- inspect Codex assets, preview import or projection changes, approve them, and roll them back.

Migration validates the copy before switching paths. A successful relocation marks and retains the source as an inactive backup and restarts Manta immediately. ASH excludes that backup from active routing and protects it from ASH's active-volume deletion flow; it does not currently change operating-system permissions to make the whole tree read-only. If the new location fails health checks after restart, Manta restores the previous bootstrap mapping. Never delete a path merely because it resembles a backup: confirm that Storage settings identifies the active volume and that the migration is complete first.

Git snapshots exclude secrets by default, and always exclude diagnostics, cache, and transient control data. A configured volume can opt in to syncing its secrets group only through the native high-risk confirmation in Storage settings. Git history is hard to erase, and a private repository is not absolute safety. Turning the option off removes secrets from the next Git snapshot and index without deleting active ASH secrets, but it cannot erase earlier Git history. Codex MCP credentials otherwise remain secret references rather than portable literal values.

## Before moving or synchronizing data

- Wait for active writes to finish and keep Manta open until it reports completion or restart.
- Ensure free space is at least the source size plus 10%, with at least 256 MiB extra.
- For cloud folders, wait until the provider reports the directory online and readable.
- Resolve reported conflict copies before the next import.
- Keep the retained source backup until the new volume has been used successfully.

See [ASH troubleshooting](../troubleshooting/agent-storage-hub.md) when onboarding, migration, Git, cloud health, or Agent projection does not complete.
