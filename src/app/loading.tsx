import { SkeletonPage } from '@/app/components/skeleton'

export default function RootLoading() {
  return <SkeletonPage titleLines={2} cardCount={6} showActionBar />
}
