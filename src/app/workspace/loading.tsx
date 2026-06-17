import { SkeletonPage } from '@/app/components/skeleton'

export default function WorkspaceLoading() {
  return (
    <SkeletonPage
      titleLines={1}
      cardCount={4}
      gridClassName="grid-cols-1 md:grid-cols-2"
      showActionBar
    />
  )
}
