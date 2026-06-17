import { SkeletonPage } from '@/app/components/skeleton'

export default function WorkflowLoading() {
  return (
    <SkeletonPage
      titleLines={1}
      cardCount={4}
      gridClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      showActionBar
    />
  )
}
