/* 日志系统React钩子 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { logger } from './index'
import type { LogEntry, LogLevel, LogType, LogSource, LogFilter, LogStats, LogReportConfig, LogExportOptions, LogExportResult } from './types'

/** 前端过滤日志条目 */
function matchFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.level?.length && !filter.level.includes(entry.level)) return false
  if (filter.type?.length && !filter.type.includes(entry.type)) return false
  if (filter.source?.length && !filter.source.includes(entry.source)) return false
  if (filter.conversationId && entry.metadata?.conversationId !== filter.conversationId) return false
  if (filter.search) {
    const s = filter.search.toLowerCase()
    const haystack = `${entry.message} ${JSON.stringify(entry.details || {})} ${(entry.tags || []).join(' ')}`.toLowerCase()
    if (!haystack.includes(s)) return false
  }
  return true
}

/** 日志状态钩子（轮询日志文件增读，前端过滤）
 * @param filter  前端过滤条件
 * @param conversationId  可选，传入后读取会话专属日志文件（~/.manta-data/conversations/<id>/log.ndjson）
 */
export function useLogState(filter?: LogFilter, conversationId?: string) {
  const [rawLogs, setRawLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const offsetRef = useRef(0)
  const filterKey = filter ? JSON.stringify(filter) : ''
  const convKey = conversationId || ''

  // filter / conversationId 变化时：清空数据、重置 offset、显示 loading
  useEffect(() => {
    offsetRef.current = 0
    setRawLogs([])
    setLoading(true)
    setError(null)
  }, [filterKey, convKey])

  // 用 useMemo 基于 rawLogs + filter 计算可见日志（最新在前）
  const { logs, stats } = useMemo(() => {
    const filtered = filter ? rawLogs.filter(l => matchFilter(l, filter)) : rawLogs
    const errorCount = filtered.filter(l => l.level === 'error' || l.level === 'fatal').length
    return {
      logs: filtered,
      stats: {
        total: filtered.length,
        errorCount,
        errorRate: filtered.length > 0 ? errorCount / filtered.length : 0,
      } as LogStats,
    }
  }, [rawLogs, filterKey])

  // 手动刷新：重置 offset，从文件头重新读取
  const refreshLogs = useCallback(async () => {
    setLoading(true)
    offsetRef.current = 0
    setRawLogs([])
    setError(null)
    const url = conversationId
      ? `/api/logs/file?offset=0&conversationId=${encodeURIComponent(conversationId)}`
      : '/api/logs/file?offset=0'
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.entries?.length > 0) {
        offsetRef.current = json.offset
        setRawLogs(json.entries.reverse())
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, convKey])

  // 轮询日志文件，增量读取
  useEffect(() => {
    let stopped = false
    let hasInitial = false

    const urlBase = conversationId
      ? `/api/logs/file?conversationId=${encodeURIComponent(conversationId)}`
      : '/api/logs/file'

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`${urlBase}&offset=${offsetRef.current}`)
        if (!res.ok) return
        const json = await res.json()
        if (json.entries?.length > 0) {
          offsetRef.current = json.offset
          setRawLogs(prev => {
            const existingIds = new Set(prev.map(l => l.id))
            const newEntries = json.entries.filter((e: LogEntry) => !existingIds.has(e.id))
            if (newEntries.length === 0) return prev
            return [...newEntries.reverse(), ...prev]
          })
          if (!hasInitial) {
            hasInitial = true
            setLoading(false)
          }
        } else if (!hasInitial) {
          hasInitial = true
          setLoading(false)
        }
      } catch {
        // 轮询失败不报错，下次继续
      }
    }

    poll()
    const timer = setInterval(poll, 1000)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, convKey])

  return {
    logs,
    stats,
    loading,
    error,
    refreshLogs,
  }
}

/** 实时日志钩子 */
export function useLiveLogs(maxEntries: number = 100) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // 定期刷新日志
    intervalRef.current = setInterval(() => {
      const allLogs = logger.getLogs()
      setLogs(allLogs.slice(0, maxEntries))
    }, 1000) // 每秒刷新

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [maxEntries])

  return logs
}

/** 日志过滤钩子 */
export function useLogFilter() {
  const [filter, setFilter] = useState<LogFilter>({})

  const updateFilter = useCallback((updates: Partial<LogFilter>) => {
    setFilter(prev => ({ ...prev, ...updates }))
  }, [])

  const resetFilter = useCallback(() => {
    setFilter({})
  }, [])

  const addLevelFilter = useCallback((level: LogLevel) => {
    setFilter(prev => ({
      ...prev,
      level: [...(prev.level || []), level],
    }))
  }, [])

  const removeLevelFilter = useCallback((level: LogLevel) => {
    setFilter(prev => ({
      ...prev,
      level: (prev.level || []).filter(l => l !== level),
    }))
  }, [])

  const addTypeFilter = useCallback((type: LogType) => {
    setFilter(prev => ({
      ...prev,
      type: [...(prev.type || []), type],
    }))
  }, [])

  const removeTypeFilter = useCallback((type: LogType) => {
    setFilter(prev => ({
      ...prev,
      type: (prev.type || []).filter(t => t !== type),
    }))
  }, [])

  const addSourceFilter = useCallback((source: LogSource) => {
    setFilter(prev => ({
      ...prev,
      source: [...(prev.source || []), source],
    }))
  }, [])

  const removeSourceFilter = useCallback((source: LogSource) => {
    setFilter(prev => ({
      ...prev,
      source: (prev.source || []).filter(s => s !== source),
    }))
  }, [])

  const setSearch = useCallback((search: string) => {
    setFilter(prev => ({ ...prev, search }))
  }, [])

  const setTimeRange = useCallback((start: string, end: string) => {
    setFilter(prev => ({
      ...prev,
      timeRange: { start, end },
    }))
  }, [])

  const clearTimeRange = useCallback(() => {
    setFilter(prev => {
      const { timeRange, ...rest } = prev
      return rest
    })
  }, [])

  return {
    filter,
    updateFilter,
    resetFilter,
    addLevelFilter,
    removeLevelFilter,
    addTypeFilter,
    removeTypeFilter,
    addSourceFilter,
    removeSourceFilter,
    setSearch,
    setTimeRange,
    clearTimeRange,
  }
}

/** 日志导出钩子 */
export function useLogExport() {
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<LogExportResult | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const exportLogs = useCallback(async (options: LogExportOptions) => {
    try {
      setExporting(true)
      setError(null)
      const result = await logger.exportLogs(options)
      setExportResult(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      throw error
    } finally {
      setExporting(false)
    }
  }, [])

  const downloadExport = useCallback((result: LogExportResult) => {
    const blob = typeof result.data === 'string' 
      ? new Blob([result.data], { type: 'text/plain' })
      : result.data

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const clearExport = useCallback(() => {
    setExportResult(null)
    setError(null)
  }, [])

  return {
    exporting,
    exportResult,
    error,
    exportLogs,
    downloadExport,
    clearExport,
  }
}

/** 日志配置钩子 */
export function useLogConfig() {
  const [config, setConfig] = useState<LogReportConfig>(logger.getConfig())

  const updateConfig = useCallback((updates: Partial<LogReportConfig>) => {
    logger.setConfig(updates)
    setConfig(logger.getConfig())
  }, [])

  const resetConfig = useCallback(() => {
    logger.setConfig({
      enabled: true,
      level: LogLevel.DEBUG,
      batchSize: 100,
      reportInterval: 5000,
      maxCacheSize: 10000,
    })
    setConfig(logger.getConfig())
  }, [])

  return {
    config,
    updateConfig,
    resetConfig,
  }
}

/** 日志操作钩子 */
export function useLogActions() {
  const [clearing, setClearing] = useState(false)
  const [reporting, setReporting] = useState(false)

  const clearLogs = useCallback(async () => {
    try {
      setClearing(true)
      logger.clearLogs()
    } finally {
      setClearing(false)
    }
  }, [])

  const reportLogs = useCallback(async () => {
    try {
      setReporting(true)
      await logger.reportLogs()
    } finally {
      setReporting(false)
    }
  }, [])

  return {
    clearing,
    reporting,
    clearLogs,
    reportLogs,
  }
}

/** 日志统计钩子 */
export function useLogStats(filter?: LogFilter) {
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshStats = useCallback(() => {
    try {
      setLoading(true)
      const logStats = logger.getStats(filter)
      setStats(logStats)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  return {
    stats,
    loading,
    refreshStats,
  }
}

/** 日志搜索钩子 */
export function useLogSearch() {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<LogEntry[]>([])
  const [searching, setSearching] = useState(false)

  const search = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([])
      return
    }

    try {
      setSearching(true)
      setSearchTerm(term)
      const results = logger.getLogs({ search: term })
      setSearchResults(results)
    } finally {
      setSearching(false)
    }
  }, [])

  const clearSearch = useCallback(() => {
    setSearchTerm('')
    setSearchResults([])
  }, [])

  return {
    searchTerm,
    searchResults,
    searching,
    search,
    clearSearch,
  }
}

/** 日志实时监控钩子 */
export function useLogMonitor(options?: {
  onNewLog?: (log: LogEntry) => void
  onError?: (log: LogEntry) => void
  onWarning?: (log: LogEntry) => void
  autoRefresh?: boolean
  refreshInterval?: number
}) {
  const {
    onNewLog,
    onError,
    onWarning,
    autoRefresh = true,
    refreshInterval = 1000,
  } = options || {}

  const [isMonitoring, setIsMonitoring] = useState(false)
  const [lastLog, setLastLog] = useState<LogEntry | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastLogCountRef = useRef(0)

  const startMonitoring = useCallback(() => {
    if (isMonitoring) return

    setIsMonitoring(true)
    lastLogCountRef.current = logger.getLogs().length

    intervalRef.current = setInterval(() => {
      const currentLogs = logger.getLogs()
      const currentCount = currentLogs.length

      if (currentCount > lastLogCountRef.current) {
        // 有新日志
        const newLogs = currentLogs.slice(0, currentCount - lastLogCountRef.current)
        
        newLogs.forEach(log => {
          setLastLog(log)
          onNewLog?.(log)

          if (log.level === LogLevel.ERROR || log.level === LogLevel.FATAL) {
            onError?.(log)
          } else if (log.level === LogLevel.WARN) {
            onWarning?.(log)
          }
        })

        lastLogCountRef.current = currentCount
      }
    }, refreshInterval)
  }, [isMonitoring, onNewLog, onError, onWarning, refreshInterval])

  const stopMonitoring = useCallback(() => {
    if (!isMonitoring) return

    setIsMonitoring(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [isMonitoring])

  useEffect(() => {
    if (autoRefresh) {
      startMonitoring()
    }

    return () => {
      stopMonitoring()
    }
  }, [autoRefresh, startMonitoring, stopMonitoring])

  return {
    isMonitoring,
    lastLog,
    startMonitoring,
    stopMonitoring,
  }
}

/** 日志性能监控钩子 */
export function useLogPerformance() {
  const [performanceLogs, setPerformanceLogs] = useState<LogEntry[]>([])
  const [averageMetrics, setAverageMetrics] = useState<Record<string, number>>({})

  useEffect(() => {
    const perfLogs = logger.getLogs({ type: [LogType.PERFORMANCE] })
    setPerformanceLogs(perfLogs)

    // 计算平均指标
    const metrics: Record<string, { sum: number; count: number }> = {}
    
    perfLogs.forEach(log => {
      const details = log.details as any
      if (details?.metric && details?.value) {
        if (!metrics[details.metric]) {
          metrics[details.metric] = { sum: 0, count: 0 }
        }
        metrics[details.metric].sum += details.value
        metrics[details.metric].count++
      }
    })

    const averages: Record<string, number> = {}
    Object.entries(metrics).forEach(([metric, data]) => {
      averages[metric] = data.sum / data.count
    })

    setAverageMetrics(averages)
  }, [])

  return {
    performanceLogs,
    averageMetrics,
  }
}

/** 日志错误分析钩子 */
export function useLogErrorAnalysis() {
  const [errorLogs, setErrorLogs] = useState<LogEntry[]>([])
  const [errorStats, setErrorStats] = useState({
    total: 0,
    byType: {} as Record<string, number>,
    bySource: {} as Record<string, number>,
    recentErrors: [] as LogEntry[],
  })

  useEffect(() => {
    const errors = logger.getLogs({
      level: [LogLevel.ERROR, LogLevel.FATAL],
    })
    setErrorLogs(errors)

    // 统计错误
    const byType: Record<string, number> = {}
    const bySource: Record<string, number> = {}

    errors.forEach(log => {
      byType[log.type] = (byType[log.type] || 0) + 1
      bySource[log.source] = (bySource[log.source] || 0) + 1
    })

    setErrorStats({
      total: errors.length,
      byType,
      bySource,
      recentErrors: errors.slice(0, 10),
    })
  }, [])

  return {
    errorLogs,
    errorStats,
  }
}