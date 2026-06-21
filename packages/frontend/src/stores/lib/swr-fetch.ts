/**
 * SWR (Stale-While-Revalidate) fetch 包装器
 * 提供请求去重、内存缓存和 stale-while-revalidate 策略
 */

// 内存缓存
const cache = new Map<string, { data: unknown; timestamp: number }>()

// 进行中的请求（用于去重）
const inflightRequests = new Map<string, Promise<unknown>>()

// 缓存新鲜时间（30秒）
const STALE_MS = 30_000

/**
 * SWR fetch 包装器
 * @param key - 缓存键（唯一标识请求）
 * @param fetcher - 实际的 fetch 函数
 * @param staleMs - 自定义缓存新鲜时间（可选）
 * @returns Promise<T>
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  staleMs: number = STALE_MS
): Promise<T> {
  // 1. 检查缓存是否新鲜
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < staleMs) {
    return cached.data as T
  }

  // 2. 检查是否有进行中的相同请求（去重）
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key) as Promise<T>
  }

  // 3. 发起新请求
  const promise = fetcher()
    .then((data) => {
      // 更新缓存
      cache.set(key, { data, timestamp: Date.now() })
      // 清除进行中标记
      inflightRequests.delete(key)
      return data
    })
    .catch((error) => {
      // 出错时也要清除进行中标记
      inflightRequests.delete(key)
      throw error
    })

  // 标记请求为进行中
  inflightRequests.set(key, promise)

  return promise
}

/**
 * 清除指定前缀的缓存
 * @param keyPrefix - 缓存键前缀
 */
export function invalidateCache(keyPrefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key)
    }
  }
}

/**
 * 清除所有缓存
 */
export function clearCache(): void {
  cache.clear()
  inflightRequests.clear()
}

/**
 * 获取缓存数据（如果存在且新鲜）
 * @param key - 缓存键
 * @param staleMs - 自定义缓存新鲜时间
 * @returns 缓存的数据或 null
 */
export function getCachedData<T>(key: string, staleMs: number = STALE_MS): T | null {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < staleMs) {
    return cached.data as T
  }
  return null
}

/**
 * 检查缓存是否新鲜
 * @param key - 缓存键
 * @param staleMs - 自定义缓存新鲜时间
 * @returns boolean
 */
export function isCacheFresh(key: string, staleMs: number = STALE_MS): boolean {
  const cached = cache.get(key)
  if (!cached) return false
  return Date.now() - cached.timestamp < staleMs
}

/**
 * 手动设置缓存
 * @param key - 缓存键
 * @param data - 要缓存的数据
 */
export function setCacheData<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

/**
 * 创建带缓存键的 fetch 函数
 * @param basePath - API 基础路径
 * @param params - 查询参数
 * @returns [cacheKey, fetcher]
 */
export function createCachedFetcher<T>(
  basePath: string,
  params?: Record<string, string | undefined>
): [string, () => Promise<T>] {
  // 构建查询字符串
  const validParams = params
    ? (Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined)
      ) as Record<string, string>)
    : {}

  const queryString = new URLSearchParams(validParams).toString()
  const url = queryString ? `${basePath}?${queryString}` : basePath
  const cacheKey = `${basePath}:${queryString}`

  const fetcher = () =>
    fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }
      return res.json()
    })

  return [cacheKey, fetcher]
}
