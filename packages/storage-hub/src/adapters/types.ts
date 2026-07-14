export const ADAPTER_SCHEMA_VERSION = 1 as const

export interface AuthorizedNativeRoot {
  readonly id: string
  readonly path: string
}

export interface AgentInstallation {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly id: string
  readonly adapterId: string
  readonly displayName: string
  readonly nativeRoots: readonly AuthorizedNativeRoot[]
}

export interface AgentAsset {
  readonly id: string
  readonly kind: string
  readonly nativePath: string
  readonly secretReferenceIds?: readonly string[]
}

export interface AgentAssetInventory {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly installationId: string
  readonly assets: readonly AgentAsset[]
}

export interface AssetSelection {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly assetIds: readonly string[]
  readonly secretReferenceIds?: readonly string[]
}

export type PreviewFileOperationKind = 'read' | 'create' | 'modify' | 'delete'

export interface PreviewFileOperation {
  readonly id: string
  readonly kind: PreviewFileOperationKind
  readonly rootId: string
  readonly nativePath: string
  /** Bound by the coordinator during preview for every existing path. */
  readonly expectedBeforeSha256?: string
  /** Required for create/modify so verification and crash rollback are deterministic. */
  readonly expectedAfterSha256?: string
}

interface AdapterPlanBase {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly planId: string
  readonly adapterId: string
  readonly target: AgentInstallation
  readonly operations: readonly PreviewFileOperation[]
  readonly createdAt: string
  readonly expiresAt: string
  readonly digest: string
}

export interface ImportPlan extends AdapterPlanBase {
  readonly kind: 'import'
}

export interface ProjectionPlan extends AdapterPlanBase {
  readonly kind: 'projection'
  readonly selection: AssetSelection
}

export type AdapterPlan = ImportPlan | ProjectionPlan

export interface PlanApproval {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly operationId: string
  readonly approvedAt: string
  readonly planId: string
  readonly adapterId: string
  readonly installationId: string
  readonly digest: string
}

export type ApprovedAdapterPlan = AdapterPlan & { readonly approval: PlanApproval }

export interface AdapterResult {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly operationId: string
  readonly planId: string
  readonly adapterId: string
  readonly installationId: string
  readonly status: 'applied' | 'committed' | 'rolled-back'
  readonly verified: boolean
  readonly completedAt: string
  readonly secretReferenceIds?: readonly string[]
}

export type AdapterJournalPhase =
  | 'journaled'
  | 'backing-up'
  | 'backed-up'
  | 'applying'
  | 'applied'
  | 'committed'
  | 'rolling-back'
  | 'rolled-back'

export interface AdapterBackupEntry {
  readonly operationId: string
  readonly operationEntryId: string
  readonly rootId: string
  readonly relativePath: string
  readonly priorState: 'file' | 'absent'
  readonly backupRelativePath?: string
  readonly priorSha256?: string
  readonly priorBytes?: number
}

export interface AdapterJournal {
  readonly schemaVersion: typeof ADAPTER_SCHEMA_VERSION
  readonly operationId: string
  readonly plan: ApprovedAdapterPlan
  readonly phase: AdapterJournalPhase
  readonly backupEntries: readonly AdapterBackupEntry[]
  readonly startedAt: string
  readonly updatedAt: string
  readonly result?: AdapterResult
}

export interface AgentAdapter {
  readonly id: string
  readonly displayName: string
  detect(): Promise<AgentInstallation[]>
  inspect(target: AgentInstallation): Promise<AgentAssetInventory>
  planImport(target: AgentInstallation): Promise<ImportPlan>
  planProjection(selection: AssetSelection, target: AgentInstallation): Promise<ProjectionPlan>
  apply(plan: ApprovedAdapterPlan): Promise<AdapterResult>
}
