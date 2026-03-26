#!/usr/bin/env node
/**
 * 敏感信息检测脚本
 * 用于 Git pre-commit 钩子，检查暂存区文件是否包含敏感信息
 * 
 * 使用方式：
 * - Git hook: npx tsx scripts/sensitive-check.ts
 * - 手动检查: npm run check:sensitive
 */

import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { execSync } from 'child_process';

// ============ 类型定义 ============

interface SensitiveRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  pattern: string;
  description: string;
  suggestion: string;
}

interface GlobalConfig {
  enabled: boolean;
  exitOnError: boolean;
  ignorePatterns: string[];
}

interface Config {
  version: string;
  global: GlobalConfig;
  rules: SensitiveRule[];
}

interface DetectionResult {
  file: string;
  line: number;
  column: number;
  rule: SensitiveRule;
  content: string;
  matchedText: string;
}

// ============ 常量定义 ============

const SEVERITY_COLORS = {
  critical: '\x1b[31m\x1b[1m', // 红色加粗
  high: '\x1b[33m',             // 黄色
  medium: '\x1b[36m',           // 青色
  low: '\x1b[37m'               // 白色
} as const;

const SEVERITY_ICONS = {
  critical: '🚨',
  high: '⚠️',
  medium: 'ℹ️',
  low: '💡'
} as const;

const RESET_COLOR = '\x1b[0m';

// ============ 工具函数 ============

/**
 * 读取配置文件
 */
function loadConfig(): Config {
  try {
    const configPath = path.join(process.cwd(), 'config', 'sensitive-rules.yaml');
    
    if (!fs.existsSync(configPath)) {
      console.error('❌ 配置文件不存在:', configPath);
      process.exit(1);
    }
    
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = parseYaml(configContent) as Config;
    
    // 验证配置
    if (!config.rules || !Array.isArray(config.rules)) {
      console.error('❌ 配置文件格式错误: rules 必须是数组');
      process.exit(1);
    }
    
    return config;
  } catch (error) {
    console.error('❌ 读取配置文件失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 获取暂存区文件列表
 */
function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter(file => fs.existsSync(file)); // 只保留实际存在的文件
  } catch (error) {
    // 如果不在 Git 仓库中或没有暂存文件，返回空数组
    return [];
  }
}

/**
 * 检查文件是否应该被忽略
 */
function shouldIgnoreFile(file: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some(pattern => {
    // 将 glob 模式转换为正则表达式
    // ** 匹配任意路径
    // * 匹配单个路径段内的任意字符
    const regexPattern = pattern
      .replace(/\*\*/g, '§§DOUBLE_STAR§§')  // 临时占位符
      .replace(/\*/g, '[^/]*')               // * 转换为 [^/]*
      .replace(/§§DOUBLE_STAR§§/g, '.*')    // ** 转换为 .*
      .replace(/\./g, '\\.');                // . 转义
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(file);
  });
}

/**
 * 解析 git diff 输出，提取行号和内容
 */
interface DiffLine {
  lineNumber: number;
  content: string;
  isAddition: boolean;
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const result: DiffLine[] = [];
  let currentLine = 0;
  
  for (const line of lines) {
    // 解析行号信息：@@ -oldStart,oldCount +newStart,newCount @@
    const lineNumberMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (lineNumberMatch) {
      currentLine = parseInt(lineNumberMatch[1], 10);
      continue;
    }
    
    // 跳过文件头信息
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
      continue;
    }
    
    // 处理新增或修改的行
    if (line.startsWith('+')) {
      result.push({
        lineNumber: currentLine,
        content: line.substring(1), // 移除前导 +
        isAddition: true
      });
      currentLine++;
    } else if (line.startsWith('-')) {
      // 删除的行不增加行号
      continue;
    } else if (!line.startsWith('\\')) {
      // 上下文行（既不是 + 也不是 -）
      currentLine++;
    }
  }
  
  return result;
}

/**
 * 检查单个文件
 */
function checkFile(file: string, rules: SensitiveRule[]): DetectionResult[] {
  const results: DetectionResult[] = [];
  
  try {
    // 获取文件变更内容
    const diff = execSync(`git diff --cached --unified=0 "${file}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (!diff.trim()) {
      return results;
    }
    
    // 解析 diff，只检查新增的行
    const diffLines = parseDiff(diff);
    
    for (const diffLine of diffLines) {
      if (!diffLine.isAddition) continue;
      
      const { lineNumber, content } = diffLine;
      
      // 对每条启用的规则进行检查
      for (const rule of rules) {
        if (!rule.enabled) continue;
        
        try {
          const regex = new RegExp(rule.pattern, 'gi');
          let match: RegExpExecArray | null;
          
          // 重置 regex 状态
          regex.lastIndex = 0;
          
          while ((match = regex.exec(content)) !== null) {
            results.push({
              file,
              line: lineNumber,
              column: match.index + 1,
              rule,
              content: content.trim(),
              matchedText: match[0]
            });
          }
        } catch (error) {
          console.warn(`⚠️  规则 ${rule.id} 的正则表达式无效:`, error instanceof Error ? error.message : error);
        }
      }
    }
  } catch (error) {
    // 静默处理错误，可能是二进制文件等
    // console.warn(`⚠️  无法检查文件 ${file}:`, error instanceof Error ? error.message : error);
  }
  
  return results;
}

/**
 * 格式化输出结果
 */
function formatResults(results: DetectionResult[]): void {
  if (results.length === 0) {
    console.log('✅ 未检测到敏感信息');
    return;
  }
  
  console.error('\n' + '='.repeat(80));
  console.error('❌ 检测到敏感信息，请处理后再提交');
  console.error('='.repeat(80) + '\n');
  
  // 按严重程度分组
  const grouped = results.reduce((acc, result) => {
    const severity = result.rule.severity;
    if (!acc[severity]) acc[severity] = [];
    acc[severity].push(result);
    return acc;
  }, {} as Record<string, DetectionResult[]>);
  
  // 按严重程度排序输出
  const severityOrder: Array<keyof typeof SEVERITY_COLORS> = ['critical', 'high', 'medium', 'low'];
  
  for (const severity of severityOrder) {
    const items = grouped[severity];
    if (!items || items.length === 0) continue;
    
    const color = SEVERITY_COLORS[severity];
    const icon = SEVERITY_ICONS[severity];
    
    console.error(`${color}${icon} [${severity.toUpperCase()}] - ${items.length} 处问题${RESET_COLOR}\n`);
    
    for (const result of items) {
      console.error(`  📄 文件: ${result.file}:${result.line}:${result.column}`);
      console.error(`  🔍 规则: ${result.rule.name} (${result.rule.id})`);
      console.error(`  📝 描述: ${result.rule.description}`);
      console.error(`  💡 建议: ${result.rule.suggestion}`);
      console.error(`  🔎 匹配: ${color}${result.matchedText}${RESET_COLOR}`);
      
      // 显示代码片段（限制长度）
      const displayContent = result.content.length > 100 
        ? result.content.substring(0, 100) + '...' 
        : result.content;
      console.error(`  📋 代码: ${displayContent}`);
      console.error('');
    }
  }
  
  // 统计信息
  const stats = {
    critical: grouped.critical?.length || 0,
    high: grouped.high?.length || 0,
    medium: grouped.medium?.length || 0,
    low: grouped.low?.length || 0
  };
  
  console.error('='.repeat(80));
  console.error(`📊 统计: Critical(${stats.critical}) High(${stats.high}) Medium(${stats.medium}) Low(${stats.low})`);
  console.error('='.repeat(80) + '\n');
  console.error('💡 提示:');
  console.error('  - 使用 git commit --no-verify 可跳过此检查（不推荐）');
  console.error('  - 编辑 config/sensitive-rules.yaml 自定义检测规则');
  console.error('  - 设置 global.enabled: false 可禁用检查\n');
}

// ============ 主函数 ============

function main() {
  try {
    console.log('🔍 开始检查敏感信息...\n');
    
    // 1. 读取配置
    const config = loadConfig();
    
    // 2. 检查是否启用
    if (!config.global.enabled) {
      console.log('⚠️  敏感信息检查已禁用（global.enabled: false）');
      process.exit(0);
    }
    
    // 3. 获取暂存文件列表
    const stagedFiles = getStagedFiles();
    
    if (stagedFiles.length === 0) {
      console.log('ℹ️  没有待提交的文件');
      process.exit(0);
    }
    
    console.log(`📁 检查 ${stagedFiles.length} 个文件...\n`);
    
    // 4. 过滤需要检查的文件
    const filesToCheck = stagedFiles.filter(
      file => !shouldIgnoreFile(file, config.global.ignorePatterns)
    );
    
    if (filesToCheck.length === 0) {
      console.log('✅ 所有文件都在忽略列表中');
      process.exit(0);
    }
    
    console.log(`🔎 实际检查 ${filesToCheck.length} 个文件（已过滤忽略项）\n`);
    
    // 5. 检查所有文件
    const allResults: DetectionResult[] = [];
    const enabledRules = config.rules.filter(rule => rule.enabled);
    
    console.log(`📋 使用 ${enabledRules.length} 条规则进行检测\n`);
    
    for (const file of filesToCheck) {
      const results = checkFile(file, enabledRules);
      allResults.push(...results);
    }
    
    // 6. 输出结果
    formatResults(allResults);
    
    // 7. 根据配置决定是否阻止提交
    if (allResults.length > 0 && config.global.exitOnError) {
      process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 敏感信息检查失败:', error instanceof Error ? error.message : error);
    console.error('💡 如需跳过检查，使用: git commit --no-verify\n');
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main();
}

export { loadConfig, getStagedFiles, checkFile, formatResults };
