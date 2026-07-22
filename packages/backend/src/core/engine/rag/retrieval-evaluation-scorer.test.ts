import { describe, expect, it } from 'vitest'
import { RetrievalEvalCaseSchema, type RetrievalEvalCase, type RetrievalEvalQueryTrace } from '@manta/contracts'
import {
  aggregateRetrievalMetrics,
  scoreRetrievalCase,
  type ScorableRetrievedChunk,
} from './retrieval-evaluation-scorer'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)

function answerableCase(overrides: Partial<RetrievalEvalCase> = {}): RetrievalEvalCase {
  return RetrievalEvalCaseSchema.parse({
    id: 'case-1',
    familyId: 'family-1',
    query: '阈值是多少？',
    source: 'expert',
    split: 'regression',
    risk: 'normal',
    expectedBehavior: 'answerable',
    requiredFacts: [{ id: 'fact-1', description: '阈值是 50 万' }],
    evidenceGroups: [{
      id: 'group-1',
      factIds: ['fact-1'],
      required: true,
      alternatives: [{
        id: 'anchor-1',
        documentId: 'doc-new',
        sourceSha256: SHA_A,
        locator: { kind: 'text', startOffset: 10, endOffset: 20 },
        quote: '超过 50 万',
      }],
    }],
    relevanceJudgments: [{ documentId: 'doc-new', sourceSha256: SHA_A, grade: 3 }],
    forbiddenSources: [],
    slices: ['exact-number'],
    ...overrides,
  })
}

function chunk(
  chunkId: string,
  documentId: string,
  content: string,
  overrides: Partial<ScorableRetrievedChunk> = {},
): ScorableRetrievedChunk {
  return { chunkId, documentId, content, score: 1, sourceSha256: SHA_A, startIndex: 0, endIndex: content.length, ...overrides }
}

describe('retrieval evaluation scorer', () => {
  it('reveals a relevant document that only becomes usable at rank 3', () => {
    const trace = scoreRetrievalCase({
      case: answerableCase(),
      finalResults: [
        chunk('noise-1', 'noise-1', '无关内容'),
        chunk('noise-2', 'noise-2', '仍然无关'),
        chunk('hit', 'doc-new', '政策超过 50 万需要复核', { startIndex: 8, endIndex: 30 }),
      ],
      latencyMs: 10,
      kValues: [1, 2, 3],
    })

    expect(trace.metricsByK['2']).toMatchObject({ docHit: 0, evidenceRecall: 0, completeEvidenceHit: 0, mrr: 0 })
    expect(trace.metricsByK['3']).toMatchObject({ docHit: 1, evidenceRecall: 1, completeEvidenceHit: 1 })
    expect(trace.metricsByK['3'].mrr).toBeCloseTo(1 / 3)
    expect(trace.metricsByK['3'].minimalCompleteK).toBe(3)
  })

  it('does not let duplicate chunks inflate recall or nDCG', () => {
    const trace = scoreRetrievalCase({
      case: answerableCase(),
      finalResults: [
        chunk('hit-1', 'doc-new', '超过 50 万需要复核', { startIndex: 8, endIndex: 25 }),
        chunk('hit-2', 'doc-new', '超过 50 万需要复核', { startIndex: 8, endIndex: 25 }),
        chunk('hit-3', 'doc-new', '超过 50 万需要复核', { startIndex: 8, endIndex: 25 }),
      ],
      latencyMs: 10,
      kValues: [3],
    })

    const metrics = trace.metricsByK['3']
    expect(metrics.docRecall).toBe(1)
    expect(metrics.evidenceRecall).toBe(1)
    expect(metrics.ndcg).toBeLessThanOrEqual(1)
    expect(metrics.redundancyRate).toBeCloseTo(2 / 3)
    expect(metrics.newEvidencePrecision).toBeCloseTo(1 / 3)
  })

  it('requires every required evidence group for multi-hop completion', () => {
    const evalCase = answerableCase({
      requiredFacts: [
        { id: 'threshold', description: '阈值' },
        { id: 'date', description: '生效日期' },
      ],
      evidenceGroups: [
        { id: 'threshold', factIds: ['threshold'], required: true, alternatives: [{ id: 'threshold-a', documentId: 'doc-new', sourceSha256: SHA_A, quote: '50 万' }] },
        { id: 'date', factIds: ['date'], required: true, alternatives: [{ id: 'date-a', documentId: 'doc-date', sourceSha256: SHA_B, quote: '2025 年生效' }] },
      ],
      relevanceJudgments: [
        { documentId: 'doc-new', sourceSha256: SHA_A, grade: 3 },
        { documentId: 'doc-date', sourceSha256: SHA_B, grade: 2 },
      ],
    })
    const trace = scoreRetrievalCase({ case: evalCase, finalResults: [chunk('threshold', 'doc-new', '阈值为 50 万')], latencyMs: 5, kValues: [1] })

    expect(trace.metricsByK['1']).toMatchObject({ evidenceRecall: 0.5, completeEvidenceHit: 0 })
  })

  it('treats alternatives inside one evidence group as OR', () => {
    const evalCase = answerableCase({
      evidenceGroups: [{
        id: 'group-1', factIds: ['fact-1'], required: true, alternatives: [
          { id: 'a', documentId: 'doc-a', sourceSha256: SHA_A, quote: '50 万' },
          { id: 'b', documentId: 'doc-b', sourceSha256: SHA_B, quote: '五十万元' },
        ],
      }],
      relevanceJudgments: [
        { documentId: 'doc-a', sourceSha256: SHA_A, grade: 3 },
        { documentId: 'doc-b', sourceSha256: SHA_B, grade: 3 },
      ],
    })
    const trace = scoreRetrievalCase({ case: evalCase, finalResults: [chunk('b', 'doc-b', '审批线是五十万元', { sourceSha256: SHA_B })], latencyMs: 5, kValues: [1] })

    expect(trace.metricsByK['1']).toMatchObject({ evidenceRecall: 1, completeEvidenceHit: 1 })
  })

  it('separates document relevance from answer-bearing evidence coverage', () => {
    const trace = scoreRetrievalCase({
      case: answerableCase(),
      finalResults: [chunk('topic', 'doc-new', '采购政策的介绍', { startIndex: 100, endIndex: 120 })],
      latencyMs: 5,
      kValues: [1],
    })

    expect(trace.metricsByK['1']).toMatchObject({ docRecall: 1, evidenceRecall: 0, completeEvidenceHit: 0 })
  })

  it('flags an outdated source without rewarding it', () => {
    const evalCase = answerableCase({
      relevanceJudgments: [
        { documentId: 'doc-new', sourceSha256: SHA_A, grade: 3 },
        { documentId: 'doc-old', sourceSha256: SHA_B, grade: 1 },
      ],
      forbiddenSources: [{ documentId: 'doc-old', sourceSha256: SHA_B, reason: 'outdated' }],
    })
    const trace = scoreRetrievalCase({
      case: evalCase,
      finalResults: [
        chunk('old', 'doc-old', '旧版阈值为 100 万', { sourceSha256: SHA_B }),
        chunk('new', 'doc-new', '新版阈值为 50 万', { startIndex: 8, endIndex: 25 }),
      ],
      latencyMs: 5,
      kValues: [1, 2],
    })

    expect(trace.metricsByK['1'].forbiddenHits.outdated).toBe(true)
    expect(trace.metricsByK['1'].docHit).toBe(0)
    expect(trace.metricsByK['2'].ndcg).toBeLessThan(1)
  })

  it('keeps no-answer retrieval metrics null and evaluates an evidence decision separately', () => {
    const evalCase = RetrievalEvalCaseSchema.parse({
      id: 'no-answer', query: '不存在的政策是什么？', expectedBehavior: 'no_answer',
      forbiddenSources: [{ documentId: 'confuser', reason: 'confuser' }],
    })
    const correct = scoreRetrievalCase({ case: evalCase, finalResults: [chunk('noise', 'noise', '相似但不支持')], evidenceStatus: 'insufficient', latencyMs: 5, kValues: [1] })
    const falseSupport = scoreRetrievalCase({ case: evalCase, finalResults: [chunk('noise', 'noise', '相似但不支持')], evidenceStatus: 'sufficient', latencyMs: 5, kValues: [1] })

    expect(correct.metricsByK['1']).toMatchObject({ docRecall: null, evidenceRecall: null, correctNoEvidence: 1, falseSupport: 0 })
    expect(falseSupport.metricsByK['1']).toMatchObject({ falseSupport: 1, correctNoEvidence: 0 })
  })

  it('flags unauthorized retrieval even for a deny case', () => {
    const evalCase = RetrievalEvalCaseSchema.parse({
      id: 'deny', query: 'CEO 住址是什么？', expectedBehavior: 'deny', risk: 'critical',
      forbiddenSources: [{ documentId: 'private-doc', sourceSha256: SHA_C, reason: 'unauthorized' }],
      principal: { id: 'employee', roles: ['employee'] },
    })
    const trace = scoreRetrievalCase({ case: evalCase, finalResults: [chunk('private', 'private-doc', '家庭住址', { sourceSha256: SHA_C })], latencyMs: 5, kValues: [1] })

    expect(trace.metricsByK['1'].forbiddenHits.unauthorized).toBe(true)
  })

  it('uses source offsets instead of formatting-sensitive quote matching', () => {
    const trace = scoreRetrievalCase({
      case: answerableCase(),
      finalResults: [chunk('ocr', 'doc-new', 'OCR 改写后的不同文本', { startIndex: 8, endIndex: 22 })],
      latencyMs: 5,
      kValues: [1],
    })

    expect(trace.metricsByK['1'].evidenceRecall).toBe(1)
  })

  it('does not match the same logical document when its source hash changed', () => {
    const trace = scoreRetrievalCase({
      case: answerableCase(),
      finalResults: [chunk('changed', 'doc-new', '超过 50 万', { sourceSha256: SHA_B, startIndex: 8, endIndex: 22 })],
      latencyMs: 5,
      kValues: [1],
    })

    expect(trace.metricsByK['1'].evidenceRecall).toBe(0)
  })

  it('annotates candidate and final rankings independently', () => {
    const hit = chunk('hit', 'doc-new', '超过 50 万', { startIndex: 8, endIndex: 22 })
    const noise = chunk('noise', 'noise', '无关')
    const trace = scoreRetrievalCase({ case: answerableCase(), candidateResults: [hit, noise], finalResults: [noise, hit], latencyMs: 5, kValues: [1, 2] })

    expect(trace.candidateMetricsByK['1'].evidenceRecall).toBe(1)
    expect(trace.metricsByK['1'].evidenceRecall).toBe(0)
    expect(trace.metricsByK['2'].evidenceRecall).toBe(1)
  })

  it('aggregates query variants by family instead of overweighting one intent', () => {
    const success = scoreRetrievalCase({ case: answerableCase({ id: 'a', familyId: 'same' }), finalResults: [chunk('hit', 'doc-new', '超过 50 万', { startIndex: 8, endIndex: 22 })], latencyMs: 5, kValues: [1] })
    const failure = scoreRetrievalCase({ case: answerableCase({ id: 'b', familyId: 'same' }), finalResults: [], latencyMs: 10, kValues: [1] })
    const otherFailure = scoreRetrievalCase({ case: answerableCase({ id: 'c', familyId: 'other' }), finalResults: [], latencyMs: 15, kValues: [1] })
    const metrics = aggregateRetrievalMetrics([success, failure, otherFailure], [1])

    expect(metrics.familyCount).toBe(2)
    expect(metrics.evidenceRecallAtK['1']).toBeCloseTo(0.25)
  })

  it('excludes infrastructure failures from quality denominators', () => {
    const success = scoreRetrievalCase({ case: answerableCase(), finalResults: [chunk('hit', 'doc-new', '超过 50 万', { startIndex: 8, endIndex: 22 })], latencyMs: 5, kValues: [1] })
    const failed: RetrievalEvalQueryTrace = { ...success, queryId: 'failed', familyId: 'failed', status: 'infra_failed', error: { code: 'EMBEDDING_DOWN', message: 'embedding unavailable' } }
    const metrics = aggregateRetrievalMetrics([success, failed], [1])

    expect(metrics.infraFailureCount).toBe(1)
    expect(metrics.evidenceRecallAtK['1']).toBe(1)
  })
})
