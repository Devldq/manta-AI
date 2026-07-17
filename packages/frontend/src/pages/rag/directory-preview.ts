export interface KnowledgeBaseDirectoryPreview {
  visible: string[]
  remaining: number
}

export function getKnowledgeBaseDirectoryPreview(
  directory: string[],
  limit = 3,
): KnowledgeBaseDirectoryPreview {
  const visible = directory.slice(0, Math.max(0, limit))
  return { visible, remaining: Math.max(0, directory.length - visible.length) }
}
