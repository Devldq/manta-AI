#!/usr/bin/env node
/* Kept as plain CommonJS so the gate runs in a freshly installed repository without a TS loader. */
const fs = require('node:fs')
const path = require('node:path')

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? path.resolve(process.argv[index + 1]) : fallback
}

const invocationRoot = process.cwd()
const root = option('--root', invocationRoot)
const allowlistPath = option('--allowlist', path.join(root, 'scripts/security/ash-storage-allowlist.json'))
const canonicalRoutingPath = option('--canonical-routing', path.join(root, 'packages/backend/src/storage/path-routing.ts'))
const typescriptPath = require.resolve('typescript', {
  paths: [invocationRoot, path.join(invocationRoot, 'packages/shared'), path.join(root, 'packages/shared')],
})
const ts = require(typescriptPath)
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : { calls: [], literals: [] }
const normalized = (value) => value.split(path.sep).join('/')
const productionExtensions = /\.(?:ts|tsx|js|mjs|cjs)$/
// E2E is test-only: it deliberately creates operating-system temporary fixtures
// and must not be interpreted as production persistence code.
const excludedDirectories = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'fixtures'])
const files = []

function walk(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) walk(absolute)
    } else if (productionExtensions.test(entry.name)
      && !/\.(?:test|spec|e2e)\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)
      && !/\.d\.(?:ts|mts|cts)$/.test(entry.name)) files.push(absolute)
  }
}
walk(path.join(root, 'packages'))
walk(path.join(root, 'scripts'))

const fsWrites = new Set([
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'truncate', 'truncateSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'rename', 'renameSync', 'rm', 'rmSync', 'unlink', 'unlinkSync', 'rmdir', 'rmdirSync',
  'open', 'openSync', 'createWriteStream',
])
const fsModules = new Set(['node:fs', 'fs', 'node:fs/promises', 'fs/promises'])
const childModules = new Set(['node:child_process', 'child_process'])
const childCalls = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
const databaseConstructors = /^(?:Database|SqliteDatabase|Level|ClassicLevel|LanceDB)$/
const forbiddenLiterals = [
  ['legacy data root', /\.manta-data/g],
  ['repository runtime root', /(?:^|['"`\\/])\.manta(?=$|['"`\\/])/g],
  ['cwd MCP token root', /\.mcp-tokens/g],
]
const violations = []
const observed = new Set()

function location(sourceFile, node) {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: point.line + 1, column: point.character + 1 }
}
function key(entry) { return `${entry.file}:${entry.line}:${entry.column}:${entry.operation}` }
function reasonValid(entry) {
  return typeof entry.reason === 'string' && entry.reason.trim().length >= 30
    && /(?:user|agent|external|build|release|audit|tool|workspace|injected|reviewed|read-only)/i.test(entry.reason)
}
function allowed(entry) {
  const match = (allowlist.calls || []).find((candidate) => key(candidate) === key(entry))
  if (!match) return false
  observed.add(`call:${key(match)}`)
  if (!reasonValid(match)) violations.push(`${key(match)}: allowlist reason is missing, too broad, or does not state the boundary`)
  return true
}
function literalAllowed(entry) {
  const match = (allowlist.literals || []).find((candidate) => key(candidate) === key(entry))
  if (!match) return false
  observed.add(`literal:${key(match)}`)
  if (!reasonValid(match)) violations.push(`${key(match)}: literal allowlist reason is missing, too broad, or does not state the boundary`)
  return true
}
function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ''
}
function propertyRoot(expression) {
  let current = expression
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression
  return ts.isIdentifier(current) ? current.text : ''
}
function propertyTail(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text
  return ''
}
function collectFacts(sourceFile) {
  const initializers = new Map()
  const trustedStorageBindings = new Map()
  const functions = new Map()
  const parameters = new Set()
  const userIdentifiers = new Set()
  const fsNamespaces = new Set()
  const fsBindings = new Map()
  const childNamespaces = new Set()
  const childBindings = new Map()
  const databaseBindings = new Set()
  const databaseNamespaces = new Set()
  const databaseFactoryBindings = new Set()
  const callableDeclarations = new Map()
  const parameterOrigins = new Map()
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text
      const clause = node.importClause
      const sourcePath = path.isAbsolute(sourceFile.fileName) ? sourceFile.fileName : path.resolve(root, sourceFile.fileName)
      const resolvedRouting = ts.resolveModuleName(moduleName, sourcePath, { moduleResolution: ts.ModuleResolutionKind.NodeJs, allowJs: true }, ts.sys).resolvedModule?.resolvedFileName
        ?? (moduleName.startsWith('.') ? ['.ts', '.tsx', '.js', ''].map((extension) => path.resolve(path.dirname(sourcePath), `${moduleName}${extension}`)).find(fs.existsSync) : undefined)
      let canonicalImport = false
      try { const resolvedReal = fs.realpathSync(resolvedRouting); const canonicalReal = fs.realpathSync(canonicalRoutingPath); canonicalImport = Boolean(resolvedRouting) && (process.platform === 'win32' ? resolvedReal.toLowerCase() === canonicalReal.toLowerCase() : resolvedReal === canonicalReal) } catch { canonicalImport = false }
      if (canonicalImport) {
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text || element.name.text
          if (['resolveStoragePath', 'safeStorageSegment'].includes(imported)) trustedStorageBindings.set(element.name.text, imported)
        }
      }
      if (['node:fs', 'fs', 'node:fs/promises', 'fs/promises'].includes(moduleName) && clause) {
        if (clause.name) fsNamespaces.add(clause.name.text)
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) fsNamespaces.add(clause.namedBindings.name.text)
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) {
          fsBindings.set(element.name.text, element.propertyName?.text || element.name.text)
        }
      }
      if (['node:child_process', 'child_process'].includes(moduleName) && clause) {
        if (clause.name) childNamespaces.add(clause.name.text)
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) childNamespaces.add(clause.namedBindings.name.text)
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) {
          childBindings.set(element.name.text, element.propertyName?.text || element.name.text)
        }
      }
      if (/^(?:better-sqlite3|level|classic-level)$/.test(moduleName) && clause?.name) databaseBindings.add(clause.name.text)
      if (/^(?:sqlite3)$/.test(moduleName) && clause?.name) databaseNamespaces.add(clause.name.text)
      if (/^(?:better-sqlite3|sqlite3|level|classic-level)$/.test(moduleName) && clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) databaseNamespaces.add(clause.namedBindings.name.text)
        else for (const element of clause.namedBindings.elements) databaseBindings.add(element.name.text)
      }
      if (/^(?:sqlite|sqlite3)$/.test(moduleName) && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) if (['open', 'openDatabase', 'connect', 'createConnection'].includes(element.propertyName?.text || element.name.text)) databaseFactoryBindings.add(element.name.text)
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'require'
      && ts.isStringLiteralLike(node.initializer.arguments[0])) {
      const moduleName = node.initializer.arguments[0].text
      const namespaceTarget = ts.isIdentifier(node.name) ? node.name.text : undefined
      const collectDestructure = (target, map) => {
        if (ts.isObjectBindingPattern(target)) for (const element of target.elements) if (ts.isIdentifier(element.name)) {
          map.set(element.name.text, element.propertyName?.getText(sourceFile) || element.name.text)
        }
      }
      if (['node:fs', 'fs', 'node:fs/promises', 'fs/promises'].includes(moduleName)) {
        if (namespaceTarget) fsNamespaces.add(namespaceTarget)
        collectDestructure(node.name, fsBindings)
      }
      if (['node:child_process', 'child_process'].includes(moduleName)) {
        if (namespaceTarget) childNamespaces.add(namespaceTarget)
        collectDestructure(node.name, childBindings)
      }
      if (/^(?:better-sqlite3|level|classic-level)$/.test(moduleName) && namespaceTarget) databaseBindings.add(namespaceTarget)
      if (moduleName === 'sqlite3' && namespaceTarget) databaseNamespaces.add(namespaceTarget)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isPropertyAccessExpression(node.initializer) && fsNamespaces.has(namespaceRoot(node.initializer))) fsNamespaces.add(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer)
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) callableDeclarations.set(node.name.text, node.initializer)
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer
      && ts.isIdentifier(node.initializer) && /^(?:request|req|task|input|args|params)$/i.test(node.initializer.text)) {
      for (const element of node.name.elements) if (ts.isIdentifier(element.name)
        && /^(?:path|file_?path|output_?path|outputDir|workspace_?path|workspaceRoot|target_?path|destination)$/i.test(element.name.text)) userIdentifiers.add(element.name.text)
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node)
      callableDeclarations.set(node.name.text, node)
      for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name)) parameters.add(parameter.name.text)
    }
    if ((ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name)) parameters.add(parameter.name.text)
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) initializers.set(node.left.text, node.right)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  function collectCalls(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const declaration = callableDeclarations.get(node.expression.text)
      if (declaration) declaration.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name) || !node.arguments[index]) return
        const originKey = `${declaration.pos}:${parameter.name.text}`
        const origins = parameterOrigins.get(originKey) || []
        origins.push(node.arguments[index])
        parameterOrigins.set(originKey, origins)
      })
    }
    ts.forEachChild(node, collectCalls)
  }
  collectCalls(sourceFile)
  return { initializers, functions, parameters, userIdentifiers, parameterOrigins, fsNamespaces, fsBindings, childNamespaces, childBindings, databaseBindings, databaseNamespaces, databaseFactoryBindings, trustedStorageBindings }
}
function namespaceRoot(expression) {
  let current = expression
  while (ts.isPropertyAccessExpression(current)) current = current.expression
  return ts.isIdentifier(current) ? current.text : ''
}
function boundOperation(expression, namespaces, bindings, inlineModules) {
  if (ts.isIdentifier(expression)) return bindings.get(expression.text)
  if (ts.isPropertyAccessExpression(expression) && namespaces.has(namespaceRoot(expression))) return expression.name.text
  if (ts.isPropertyAccessExpression(expression) && ts.isCallExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === 'require'
    && ts.isStringLiteralLike(expression.expression.arguments[0])) {
    const moduleName = expression.expression.arguments[0].text
    if (inlineModules.has(moduleName)) return expression.name.text
  }
  return undefined
}
function classify(expression, facts, seen = new Set()) {
  if (!expression || seen.has(expression) || seen.size > 40) return 'unknown'
  seen.add(expression)
  if (ts.isStringLiteralLike(expression)) {
    const value = expression.text
    return value && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes('..') ? 'segment' : 'unknown'
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return classify(expression.expression, facts, seen)
  if (ts.isIdentifier(expression)) {
    if (facts.userIdentifiers.has(expression.text)) return 'user'
    if (/^(?:outputPath|outputDir|workspacePath|workspaceRoot|userSelectedPath)$/i.test(expression.text) && facts.parameters.has(expression.text)) return 'user'
    let owner = expression.parent
    while (owner && !ts.isFunctionLike(owner)) owner = owner.parent
    if (owner) {
      const origins = facts.parameterOrigins.get(`${owner.pos}:${expression.text}`) || []
      if (origins.length) {
        const kinds = origins.map((origin) => classify(origin, facts, new Set(seen)))
        if (kinds.every((kind) => kind === 'ash')) return 'ash'
        if (kinds.every((kind) => kind === 'user')) return 'user'
      }
    }
    return classify(facts.initializers.get(expression.text), facts, seen)
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (ts.isExpression(expression.body)) return classify(expression.body, facts, seen)
    const returns = []
    function findReturns(node) {
      if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression)
      else if (node !== expression.body && ts.isFunctionLike(node)) return
      else ts.forEachChild(node, findReturns)
    }
    findReturns(expression.body)
    const kinds = returns.map((value) => classify(value, facts, new Set(seen)))
    if (kinds.length && kinds.every((kind) => kind === 'ash')) return 'ash'
    if (kinds.length && kinds.every((kind) => kind === 'user')) return 'user'
    return 'unknown'
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const rootName = propertyRoot(expression)
    const tail = propertyTail(expression)
    if (/^(?:request|req|task|input|args|params|options)$/i.test(rootName)
      && /^(?:path|filePath|outputPath|outputDir|workspacePath|workspaceRoot|targetPath|destination)$/i.test(tail)) return 'user'
    return classify(expression.expression, facts, seen)
  }
  if (ts.isConditionalExpression(expression)) {
    const left = classify(expression.whenTrue, facts, new Set(seen))
    const right = classify(expression.whenFalse, facts, new Set(seen))
    return left === right ? left : 'unknown'
  }
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(expression.operatorToken.kind)) {
    const left = classify(expression.left, facts, new Set(seen))
    const right = classify(expression.right, facts, new Set(seen))
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (['ash', 'user'].includes(left) && right === 'segment') return left
      if (left === 'segment' && ['ash', 'user'].includes(right)) return right
    } else if (left === right) return left
    return 'unknown'
  }
  if (ts.isTemplateExpression(expression)) {
    return 'unknown'
  }
  if (ts.isCallExpression(expression)) {
    const name = calleeName(expression.expression)
    if (ts.isIdentifier(expression.expression) && facts.trustedStorageBindings.get(expression.expression.text) === 'safeStorageSegment') return 'segment'
    if (ts.isIdentifier(expression.expression) && facts.trustedStorageBindings.get(expression.expression.text) === 'resolveStoragePath') return 'ash'
    if (name === 'resolve' && ts.isPropertyAccessExpression(expression.expression)
      && /(?:storage|resolver)/i.test(expression.expression.expression.getText())) return 'ash'
    if (['join', 'resolve', 'normalize', 'dirname'].includes(name)) {
      const kinds = expression.arguments.map((argument) => classify(argument, facts, new Set(seen)))
      if (name === 'dirname' || name === 'normalize') return kinds.length === 1 && ['ash', 'user'].includes(kinds[0]) ? kinds[0] : 'unknown'
      if (!kinds.length || !['ash', 'user'].includes(kinds[0])) return 'unknown'
      return kinds.slice(1).every((kind) => kind === 'segment') ? kinds[0] : 'unknown'
    }
    if (/^(?:resolve|normalize|expand)(?:User)?Path$/i.test(name)) {
      const kinds = expression.arguments.map((argument) => classify(argument, facts, new Set(seen)))
      if (kinds.includes('user')) return 'user'
      if (kinds.includes('ash')) return 'ash'
    }
    if (ts.isIdentifier(expression.expression)) {
      const initializer = facts.initializers.get(expression.expression.text)
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        const kind = classify(initializer, facts, new Set(seen))
        if (kind !== 'unknown') return kind
      }
      const declaration = facts.functions.get(expression.expression.text)
      if (declaration && declaration.body) {
        const returns = []
        function findReturns(node) {
          if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression)
          else if (node !== declaration && ts.isFunctionLike(node)) return
          else ts.forEachChild(node, findReturns)
        }
        findReturns(declaration.body)
        const kinds = returns.map((value) => classify(value, facts, new Set(seen)))
        if (kinds.length && kinds.every((kind) => kind === 'ash')) return 'ash'
        if (kinds.length && kinds.every((kind) => kind === 'user')) return 'user'
      }
    }
  }
  return 'unknown'
}
function stringValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined
}
function arrayStrings(node) {
  return node && ts.isArrayLiteralExpression(node) ? node.elements.map(stringValue) : []
}
function childIsReadOnly(node) {
  const rawCommand = stringValue(node.arguments[0])
  let command = rawCommand
  let args = arrayStrings(node.arguments[1])
  if (rawCommand && !args.length && /\s/.test(rawCommand)) {
    const parts = rawCommand.trim().split(/\s+/)
    command = parts.shift()
    args = parts
  }
  if (command === 'claude' && args[0] === 'plugin' && ['list', 'show', 'inspect'].includes(args[1])) return true
  if (command === 'ollama' && ['list', 'show', 'ps'].includes(args[0])) return true
  if (['where', 'which', 'where.exe'].includes(command)) return true
  if (command === 'git' && ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'remote'].includes(args[0])) return true
  return false
}
function writeArguments(operation, node) {
  if (['copyFile', 'copyFileSync', 'cp', 'cpSync'].includes(operation)) return node.arguments[1] ? [node.arguments[1]] : []
  if (['rename', 'renameSync'].includes(operation)) return node.arguments.slice(0, 2)
  return node.arguments[0] ? [node.arguments[0]] : []
}
function databasePathArgument(node) {
  const first = node.arguments && node.arguments[0]
  if (!first || !ts.isObjectLiteralExpression(first)) return first
  const property = first.properties.find((candidate) => ts.isPropertyAssignment(candidate)
    && ['filename', 'database', 'path'].includes(candidate.name.getText().replace(/["']/g, '')))
  return property && property.initializer
}

for (const absolute of files) {
  const relative = normalized(path.relative(root, absolute))
  const source = fs.readFileSync(absolute, 'utf8')
  const sourceFile = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true,
    /tsx$/.test(relative) ? ts.ScriptKind.TSX : /jsx?$/.test(relative) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const facts = collectFacts(sourceFile)
  function report(node, operation, detail) {
    const point = location(sourceFile, node)
    const entry = { file: relative, ...point, operation }
    if (!allowed(entry)) violations.push(`${relative}:${point.line}:${point.column}: ${operation} ${detail}`)
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const operation = boundOperation(node.expression, facts.fsNamespaces, facts.fsBindings, fsModules)
      if (fsWrites.has(operation)) {
        if (['open', 'openSync'].includes(operation)) {
          const flags = stringValue(node.arguments[1])
          if (flags && /^(?:r|rs)$/.test(flags)) { ts.forEachChild(node, visit); return }
        }
        const paths = writeArguments(operation, node)
        if (!paths.length || paths.some((argument) => !['ash', 'user'].includes(classify(argument, facts)))) report(node, operation, 'uses an unrouted persistence path')
      } else {
        const childOperation = boundOperation(node.expression, facts.childNamespaces, facts.childBindings, childModules)
        if (childCalls.has(childOperation) && !childIsReadOnly(node)) report(node, childOperation, 'is a child-process write boundary without an exact review')
        const databaseOperation = ts.isIdentifier(node.expression) && facts.databaseFactoryBindings.has(node.expression.text) ? node.expression.text : undefined
        if (databaseOperation && classify(databasePathArgument(node), facts) !== 'ash') report(node, databaseOperation, 'uses an unrouted database path')
      }
    } else if (ts.isNewExpression(node)) {
      const operation = calleeName(node.expression)
      const first = node.arguments && node.arguments[0]
      const namespaceDatabase = ts.isPropertyAccessExpression(node.expression)
        && facts.databaseNamespaces.has(namespaceRoot(node.expression)) && databaseConstructors.test(operation)
      if ((facts.databaseBindings.has(operation) || namespaceDatabase || databaseConstructors.test(operation) && facts.databaseBindings.size > 0)
        && classify(first, facts) !== 'ash') report(node, operation, 'uses an unrouted database path')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  for (const [name, pattern] of forbiddenLiterals) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source))) {
      const point = sourceFile.getLineAndCharacterOfPosition(match.index)
      const entry = { file: relative, line: point.line + 1, column: point.character + 1, operation: name }
      if (!literalAllowed(entry)) violations.push(`${relative}:${entry.line}:${entry.column}: forbidden ${name}`)
      if (match[0].length === 0) pattern.lastIndex += 1
    }
  }
}

for (const entry of allowlist.calls || []) {
  if (!observed.has(`call:${key(entry)}`)) violations.push(`${key(entry)}: stale allowlist entry`)
}
for (const entry of allowlist.literals || []) {
  if (!observed.has(`literal:${key(entry)}`)) violations.push(`${key(entry)}: stale literal allowlist entry`)
}

if (violations.length) {
  console.error(`ASH storage audit failed (${violations.length} violation${violations.length === 1 ? '' : 's'}):`)
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`ASH storage audit passed (${files.length} production source files scanned).`)
}
