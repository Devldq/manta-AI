import { SkeletonPage } from '@/app/components/skeleton'

export default function ThemesLoading() {
  return (
    <SkeletonPage
      titleLines={1}
      cardCount={6}
      gridClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
    />
  )
}
