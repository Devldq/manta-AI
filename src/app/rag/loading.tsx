import { SkeletonPage } from '@/app/components/skeleton'

export default function RagLoading() {
  return (
    <SkeletonPage
      titleLines={1}
      cardCount={3}
      gridClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      showActionBar
    />
  )
}
