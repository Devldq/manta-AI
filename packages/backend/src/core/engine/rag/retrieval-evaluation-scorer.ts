import { createHash } from 'node:crypto'
import {
  RetrievalEvalCaseSchema,
  type RetrievalEvalCase,
  type RetrievalEvalCaseMetrics,
  type RetrievalEvalChunkTrace,
  type RetrievalEvalEvidenceAnchor,
  type RetrievalEvalEvidenceGroup,
  type RetrievalEvalForbiddenSource,
  type RetrievalEvalQueryTrace,
  type RetrievalEvaluationMetrics,
} from '@manta/contracts'

export const RETRIEVAL_METRIC_SPEC_VERSION = 'retrieval-v2.0'
export const DEFAULT_RETRIEVAL_K_VALUES = [1, 3, 5, 10] as const
const DEFAULT_ANCHOR_COVERAGE = 0.8

export interface ScorableRetrievedChunk {
  chunkId: string
  documentId: string
  content: string
  score: number
  sourceSha256?: string
  sourceVersion?: string
  startIndex?: number
  endIndex?: number
}

export interface ScoreRetrievalCaseInput {
  case: RetrievalEvalCase
  candidateResults?: ScorableRetrievedChunk[]
  finalResults: ScorableRetrievedChunk[]
  latencyMs: number
  kValues?: number[]
  evidenceStatus?: 'sufficient' | 'insufficient'
}

interface NormalizedGold {
  groups: RetrievalEvalEvidenceGroup[]
  requiredGroups: RetrievalEvalEvidenceGroup[]
  forbidden: RetrievalEvalForbiddenSource[]
  grades: Map<string, number>
  relevantDocuments: Set<string>
}

export function scoreRetrievalCase(input: ScoreRetrievalCaseInput): RetrievalEvalQueryTrace {
  const evalCase = RetrievalEvalCaseSchema.parse(input.case)
  const kValues = normalizeKValues(input.kValues)
  const gold = normalizeGold(evalCase)
  const candidateResults = annotateResults(input.candidateResults ?? input.finalResults, gold)
  const finalResults = annotateResults(input.finalResults, gold)
  const minimalCompleteK = findMinimalCompleteK(finalResults, gold.requiredGroups)

  return {
    queryId: evalCase.id,
    familyId: evalCase.familyId ?? evalCase.id,
    query: evalCase.query,
    expectedBehavior: evalCase.expectedBehavior,
    risk: evalCase.risk,
    split: evalCase.split,
    slices: evalCase.slices,
    forbiddenReasonsExpected: unique(evalCase.forbiddenSources.map((source) => source.reason)),
    latencyMs: input.latencyMs,
    status: 'scored',
    candidateResults,
    finalResults,
    candidateMetricsByK: scoreByK(evalCase, candidateResults, gold, kValues, input.evidenceStatus, findMinimalCompleteK(candidateResults, gold.requiredGroups)),
    metricsByK: scoreByK(evalCase, finalResults, gold, kValues, input.evidenceStatus, minimalCompleteK),
  }
}

export function aggregateRetrievalMetrics(
  traces: RetrievalEvalQueryTrace[],
  kValues: number[] = [...DEFAULT_RETRIEVAL_K_VALUES],
  metricSpecVersion = RETRIEVAL_METRIC_SPEC_VERSION,
): RetrievalEvaluationMetrics {
  const normalizedK = normalizeKValues(kValues)
  const scored = traces.filter((trace) => trace.status === 'scored')
  const families = new Set(scored.map((trace) => trace.familyId))
  const metricsAt = (field: keyof RetrievalEvalCaseMetrics): Record<string, number | null> => Object.fromEntries(
    normalizedK.map((k) => [String(k), familyMacroAverage(scored, k, field)]),
  )
  const forbiddenHitRateAtK = Object.fromEntries(normalizedK.map((k) => [String(k), {
    outdated: forbiddenRate(scored, k, 'outdated'),
    unauthorized: forbiddenRate(scored, k, 'unauthorized'),
    knownWrong: forbiddenRate(scored, k, 'known_wrong'),
    confuser: forbiddenRate(scored, k, 'confuser'),
  }]))
  const latencies = scored.map((trace) => trace.latencyMs).sort((left, right) => left - right)
  const primaryK = normalizedK.includes(5) ? 5 : normalizedK.at(-1) ?? 1
  const evidenceRecallAtK = metricsAt('evidenceRecall')
  const mrrAtK = metricsAt('mrr')
  const ndcgByK = metricsAt('ndcg')

  return {
    metricSpecVersion,
    kValues: normalizedK,
    caseCount: traces.length,
    familyCount: families.size,
    answerableCaseCount: scored.filter((trace) => trace.expectedBehavior === 'answerable').length,
    noAnswerCaseCount: scored.filter((trace) => trace.expectedBehavior !== 'answerable').length,
    infraFailureCount: traces.filter((trace) => trace.status === 'infra_failed').length,
    docHitAtK: metricsAt('docHit'),
    docRecallAtK: metricsAt('docRecall'),
    evidenceRecallAtK,
    completeEvidenceHitAtK: metricsAt('completeEvidenceHit'),
    mrrAtK,
    ndcgByK,
    newEvidencePrecisionAtK: metricsAt('newEvidencePrecision'),
    evidenceChunkPrecisionAtK: metricsAt('evidenceChunkPrecision'),
    redundancyRateAtK: metricsAt('redundancyRate'),
    noRelevantHitRateAtK: metricsAt('noRelevantHit'),
    forbiddenHitRateAtK,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    recallAtK: evidenceRecallAtK[String(primaryK)] ?? undefined,
    mrr: mrrAtK[String(primaryK)] ?? undefined,
    ndcgAtK: ndcgByK[String(primaryK)] ?? undefined,
    zeroResultRate: scored.length ? scored.filter((trace) => trace.finalResults.length === 0).length / scored.length : 0,
  }
}

function normalizeGold(evalCase: RetrievalEvalCase): NormalizedGold {
  const legacyGroups: RetrievalEvalEvidenceGroup[] = evalCase.relevantSources.map((source, index) => ({
    id: `legacy-${evalCase.id}-${index}`,
    factIds: [],
    required: true,
    alternatives: [{
      id: `legacy-anchor-${evalCase.id}-${index}`,
      documentId: source.documentId,
      sourceSha256: source.sourceSha256,
      quote: source.quote,
      ...(source.startOffset !== undefined && source.endOffset !== undefined
        ? { locator: { kind: 'text' as const, startOffset: source.startOffset, endOffset: source.endOffset } }
        : {}),
    }],
  }))
  const groups = [...evalCase.evidenceGroups, ...legacyGroups]
  const forbiddenKeys = new Set(evalCase.forbiddenSources.map(sourceKey))
  const grades = new Map<string, number>()

  for (const judgment of evalCase.relevanceJudgments) {
    grades.set(sourceKey(judgment), evalCase.forbiddenSources.some((source) => sourcesMatch(source, judgment)) ? 0 : judgment.grade)
  }
  for (const group of groups) {
    for (const anchor of group.alternatives) {
      const key = sourceKey(anchor)
      if (!grades.has(key) && !forbiddenKeys.has(key)) grades.set(key, 3)
    }
  }

  const relevantDocuments = new Set<string>()
  for (const judgment of evalCase.relevanceJudgments) if (judgment.grade >= 2 && !evalCase.forbiddenSources.some((source) => sourcesMatch(source, judgment))) relevantDocuments.add(judgment.documentId)
  for (const group of groups.filter((item) => item.required)) for (const anchor of group.alternatives) if (!evalCase.forbiddenSources.some((source) => sourcesMatch(source, anchor))) relevantDocuments.add(anchor.documentId)

  return { groups, requiredGroups: groups.filter((group) => group.required), forbidden: evalCase.forbiddenSources, grades, relevantDocuments }
}

function annotateResults(results: ScorableRetrievedChunk[], gold: NormalizedGold): RetrievalEvalChunkTrace[] {
  const coveredGroups = new Set<string>()
  return results.map((result, index) => {
    const matchedAnchors: RetrievalEvalEvidenceAnchor[] = []
    const matchedGroups: string[] = []
    for (const group of gold.groups) {
      const anchors = group.alternatives.filter((anchor) => anchorMatchesChunk(anchor, result))
      if (!anchors.length) continue
      matchedAnchors.push(...anchors)
      matchedGroups.push(group.id)
    }
    const newlyCoveredGroupIds = unique(matchedGroups.filter((id) => !coveredGroups.has(id)))
    for (const id of matchedGroups) coveredGroups.add(id)
    const forbiddenReasons = unique(gold.forbidden.filter((source) => sourceMatchesChunk(source, result)).map((source) => source.reason))
    return {
      rank: index + 1,
      chunkId: result.chunkId,
      documentId: result.documentId,
      sourceSha256: result.sourceSha256,
      sourceVersion: result.sourceVersion,
      content: result.content,
      contentHash: sha256(result.content),
      score: result.score,
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      relevantGrade: forbiddenReasons.length ? 0 : gradeForChunk(result, gold),
      matchedAnchorIds: unique(matchedAnchors.map((anchor) => anchor.id)),
      matchedGroupIds: unique(matchedGroups),
      newlyCoveredGroupIds,
      forbiddenReasons,
    }
  })
}

function scoreByK(
  evalCase: RetrievalEvalCase,
  results: RetrievalEvalChunkTrace[],
  gold: NormalizedGold,
  kValues: number[],
  evidenceStatus: ScoreRetrievalCaseInput['evidenceStatus'],
  minimalCompleteK: number | null,
): Record<string, RetrievalEvalCaseMetrics> {
  return Object.fromEntries(kValues.map((k) => [String(k), scoreAtK(evalCase, results.slice(0, k), gold, evidenceStatus, minimalCompleteK)]))
}

function scoreAtK(
  evalCase: RetrievalEvalCase,
  results: RetrievalEvalChunkTrace[],
  gold: NormalizedGold,
  evidenceStatus: ScoreRetrievalCaseInput['evidenceStatus'],
  minimalCompleteK: number | null,
): RetrievalEvalCaseMetrics {
  const forbiddenHits = {
    outdated: results.some((result) => result.forbiddenReasons.includes('outdated')),
    unauthorized: results.some((result) => result.forbiddenReasons.includes('unauthorized')),
    knownWrong: results.some((result) => result.forbiddenReasons.includes('known_wrong')),
    confuser: results.some((result) => result.forbiddenReasons.includes('confuser')),
  }
  if (evalCase.expectedBehavior !== 'answerable') {
    return {
      docHit: null,
      docRecall: null,
      evidenceRecall: null,
      completeEvidenceHit: null,
      mrr: null,
      ndcg: null,
      newEvidencePrecision: null,
      evidenceChunkPrecision: null,
      redundancyRate: null,
      noRelevantHit: null,
      falseSupport: evidenceStatus ? Number(evidenceStatus === 'sufficient') : null,
      correctNoEvidence: evidenceStatus ? Number(evidenceStatus === 'insufficient') : null,
      minimalCompleteK: null,
      forbiddenHits,
    }
  }

  const returned = results.length
  const relevantDocs = new Set(results.filter((result) => result.relevantGrade >= 2).map((result) => result.documentId))
  const coveredGroups = new Set(results.flatMap((result) => result.matchedGroupIds))
  const coveredRequired = gold.requiredGroups.filter((group) => coveredGroups.has(group.id)).length
  const evidenceRecall = gold.requiredGroups.length ? coveredRequired / gold.requiredGroups.length : 0
  const firstRelevant = results.findIndex((result) => result.relevantGrade >= 2)
  const seenDocuments = new Set<string>()
  const dcg = results.reduce((sum, result, index) => {
    if (seenDocuments.has(result.documentId)) return sum
    seenDocuments.add(result.documentId)
    return sum + relevanceGain(result.relevantGrade) / Math.log2(index + 2)
  }, 0)
  const idealGrades = idealDocumentGrades(gold)
  const idcg = idealGrades.slice(0, results.length).reduce((sum, grade, index) => sum + relevanceGain(grade) / Math.log2(index + 2), 0)
  const relevantChunks = results.filter((result) => result.matchedGroupIds.length > 0)
  const novelChunks = results.filter((result) => result.newlyCoveredGroupIds.length > 0)
  const redundantChunks = results.filter((result) => result.matchedGroupIds.length > 0 && result.newlyCoveredGroupIds.length === 0)

  return {
    docHit: Number(relevantDocs.size > 0),
    docRecall: gold.relevantDocuments.size ? relevantDocs.size / gold.relevantDocuments.size : 0,
    evidenceRecall,
    completeEvidenceHit: Number(gold.requiredGroups.length > 0 && coveredRequired === gold.requiredGroups.length),
    mrr: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    ndcg: idcg ? Math.min(1, dcg / idcg) : 0,
    newEvidencePrecision: returned ? novelChunks.length / returned : 0,
    evidenceChunkPrecision: returned ? relevantChunks.length / returned : 0,
    redundancyRate: returned ? redundantChunks.length / returned : 0,
    noRelevantHit: Number(evidenceRecall === 0),
    falseSupport: null,
    correctNoEvidence: null,
    minimalCompleteK,
    forbiddenHits,
  }
}

function anchorMatchesChunk(anchor: RetrievalEvalEvidenceAnchor, chunk: ScorableRetrievedChunk): boolean {
  if (anchor.documentId !== chunk.documentId) return false
  if (anchor.sourceSha256 && anchor.sourceSha256 !== chunk.sourceSha256) return false
  if (anchor.locator?.kind === 'text' && chunk.startIndex !== undefined && chunk.endIndex !== undefined) {
    const intersection = Math.max(0, Math.min(anchor.locator.endOffset, chunk.endIndex) - Math.max(anchor.locator.startOffset, chunk.startIndex))
    const anchorLength = anchor.locator.endOffset - anchor.locator.startOffset
    return anchorLength > 0 && intersection / anchorLength >= DEFAULT_ANCHOR_COVERAGE
  }
  return normalizedContains(chunk.content, anchor.quote)
}

function sourceMatchesChunk(source: RetrievalEvalForbiddenSource, chunk: ScorableRetrievedChunk): boolean {
  return source.documentId === chunk.documentId && (!source.sourceSha256 || source.sourceSha256 === chunk.sourceSha256)
}

function gradeForChunk(chunk: ScorableRetrievedChunk, gold: NormalizedGold): number {
  const exact = gold.grades.get(sourceKey(chunk))
  if (exact !== undefined) return exact
  const documentOnly = [...gold.grades.entries()].filter(([key]) => key.startsWith(`${chunk.documentId}:`)).map(([, grade]) => grade)
  return documentOnly.length ? Math.max(...documentOnly) : 0
}

function idealDocumentGrades(gold: NormalizedGold): number[] {
  const byDocument = new Map<string, number>()
  for (const [key, grade] of gold.grades) {
    const documentId = key.slice(0, key.lastIndexOf(':'))
    byDocument.set(documentId, Math.max(byDocument.get(documentId) ?? 0, grade))
  }
  return [...byDocument.values()].filter((grade) => grade > 0).sort((left, right) => right - left)
}

function findMinimalCompleteK(results: RetrievalEvalChunkTrace[], requiredGroups: RetrievalEvalEvidenceGroup[]): number | null {
  if (!requiredGroups.length) return null
  const required = new Set(requiredGroups.map((group) => group.id))
  const covered = new Set<string>()
  for (const result of results) {
    for (const id of result.matchedGroupIds) if (required.has(id)) covered.add(id)
    if (covered.size === required.size) return result.rank
  }
  return null
}

function familyMacroAverage(traces: RetrievalEvalQueryTrace[], k: number, field: keyof RetrievalEvalCaseMetrics): number | null {
  const families = new Map<string, number[]>()
  for (const trace of traces) {
    const value = trace.metricsByK[String(k)]?.[field]
    if (typeof value !== 'number') continue
    const values = families.get(trace.familyId) ?? []
    values.push(value)
    families.set(trace.familyId, values)
  }
  const familyMeans = [...families.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length)
  return average(familyMeans)
}

function forbiddenRate(
  traces: RetrievalEvalQueryTrace[],
  k: number,
  reason: 'outdated' | 'unauthorized' | 'known_wrong' | 'confuser',
): number | null {
  const eligible = traces.filter((trace) => trace.forbiddenReasonsExpected.includes(reason))
  if (!eligible.length) return null
  const field = reason === 'known_wrong' ? 'knownWrong' : reason
  return eligible.filter((trace) => trace.metricsByK[String(k)]?.forbiddenHits[field]).length / eligible.length
}

function sourceKey(source: { documentId: string; sourceSha256?: string }): string {
  return `${source.documentId}:${source.sourceSha256 ?? '*'}`
}

function sourcesMatch(left: { documentId: string; sourceSha256?: string }, right: { documentId: string; sourceSha256?: string }): boolean {
  return left.documentId === right.documentId && (!left.sourceSha256 || !right.sourceSha256 || left.sourceSha256 === right.sourceSha256)
}

function normalizeKValues(values?: number[]): number[] {
  const normalized = unique((values?.length ? values : [...DEFAULT_RETRIEVAL_K_VALUES]).filter((value) => Number.isInteger(value) && value > 0)).sort((left, right) => left - right)
  if (!normalized.length) throw new Error('At least one positive K value is required')
  return normalized
}

function normalizedContains(content: string, quote: string): boolean {
  const left = content.replace(/\s+/g, ' ').trim().toLowerCase()
  const right = quote.replace(/\s+/g, ' ').trim().toLowerCase()
  return Boolean(left && right && (left.includes(right) || right.includes(left)))
}

function relevanceGain(grade: number): number { return 2 ** grade - 1 }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function percentile(values: number[], quantile: number): number { return values.length ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))] : 0 }
