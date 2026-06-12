/* 日志系统测试 */

import { logger, logManager } from './src/core/observability/log'
import { LogLevel, LogType, LogSource } from './src/core/observability/log/types'

// 测试日志记录
console.log('=== 测试日志系统 ===')

// 1. 测试基本日志记录
console.log('\n1. 测试基本日志记录:')
logger.debug('这是一条调试日志', { conversationId: 'test-conv-1' }, ['test', 'debug'])
logger.info('这是一条信息日志', { messageId: 'test-msg-1' }, ['test', 'info'])
logger.warn('这是一条警告日志', { stepIndex: 1 }, ['test', 'warn'])
logger.error('这是一条错误日志', new Error('测试错误'), { toolCallId: 'test-tc-1' }, ['test', 'error'])
logger.fatal('这是一条致命错误日志', new Error('致命错误'), {}, ['test', 'fatal'])

// 2. 测试工具调用日志
console.log('\n2. 测试工具调用日志:')
logger.toolCall(
  'readFile',
  'tc-123',
  { file_path: '/test/file.txt' },
  { content: '文件内容' },
  false,
  undefined,
  { conversationId: 'test-conv-1' }
)

// 3. 测试Agent循环日志
console.log('\n3. 测试Agent循环日志:')
logger.agentLoop(
  0,
  5,
  3,
  1500,
  { messageId: 'test-msg-1' }
)

// 4. 测试系统日志
console.log('\n4. 测试系统日志:')
logger.system(
  'AgentLoop',
  '执行完成',
  'success',
  { conversationId: 'test-conv-1' }
)

// 5. 测试性能日志
console.log('\n5. 测试性能日志:')
logger.performance(
  'response_time',
  1500,
  'ms',
  { conversationId: 'test-conv-1' }
)

// 6. 测试用户操作日志
console.log('\n6. 测试用户操作日志:')
logger.userAction(
  '发送消息',
  { messageLength: 100 },
  { userId: 'user-123' }
)

// 7. 测试工作流日志
console.log('\n7. 测试工作流日志:')
logger.workflow(
  'wf-123',
  'step-1',
  '执行完成',
  'success',
  { taskId: 'task-123' }
)

// 8. 获取日志统计
console.log('\n8. 获取日志统计:')
const stats = logger.getStats()
console.log('总日志数:', stats.total)
console.log('错误率:', (stats.errorRate * 100).toFixed(2) + '%')
console.log('按级别统计:', stats.byLevel)
console.log('按类型统计:', stats.byType)
console.log('按来源统计:', stats.bySource)

// 9. 获取所有日志
console.log('\n9. 获取所有日志:')
const allLogs = logger.getLogs()
console.log('日志数量:', allLogs.length)

// 10. 测试过滤器
console.log('\n10. 测试过滤器:')
const errorLogs = logger.getLogs({ level: [LogLevel.ERROR, LogLevel.FATAL] })
console.log('错误日志数量:', errorLogs.length)

const toolLogs = logger.getLogs({ type: [LogType.TOOL_CALL] })
console.log('工具调用日志数量:', toolLogs.length)

// 11. 测试格式化
console.log('\n11. 测试格式化:')
if (allLogs.length > 0) {
  const formatted = logger.formatLog(allLogs[0])
  console.log('格式化后的日志:', formatted)
}

// 12. 测试清空日志
console.log('\n12. 测试清空日志:')
logger.clearLogs()
const clearedStats = logger.getStats()
console.log('清空后日志数量:', clearedStats.total)

console.log('\n=== 测试完成 ===')