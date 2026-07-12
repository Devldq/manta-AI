#!/usr/bin/env node
/* This file intentionally uses JavaScript syntax so the repository's Node 20 can run it directly. */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const scopes = [
  'packages/backend/src', 'packages/rag/src', 'packages/agent-sandbox/src',
  'packages/desktop/src', 'packages/shared/src', 'packages/frontend/src',
]
const allowlistPath = path.join(root, 'scripts/security/ash-storage-allowlist.json')
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
const normalized = (value) => value.split(path.sep).join('/')
const files = []
const literalFiles = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute)
  }
}
for (const scope of scopes) walk(path.join(root, scope))
function walkLiteral(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory() && !['node_modules', 'dist', 'coverage', '.turbo'].includes(entry.name)) walkLiteral(absolute)
    else if (/\.(?:ts|tsx|js|mjs|cjs|sh|json)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx|js)$/.test(entry.name)) literalFiles.push(absolute)
  }
}
for (const scope of ['packages', 'scripts']) walkLiteral(path.join(root, scope))

const violations = []
const used = { writerFiles: new Set(), homeAndCwdFiles: new Set(), literalFiles: new Set() }
const forbidden = [
  { name: 'legacy data root', pattern: /\.manta-data/g },
  { name: 'repository runtime root', pattern: /(?:['"`]\.manta['"`]|\.manta[\\/])/g },
  { name: 'cwd MCP token root', pattern: /\.mcp-tokens/g },
]
const writerPattern = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|copyFile|copyFileSync|rename|renameSync)\s*\(|\bnew\s+Database\s*\(/
const homeCwdPattern = /\b(?:os\.)?homedir\s*\(|\bUSERPROFILE\b|\bprocess\.cwd\s*\(/

for (const absolute of files) {
  const relative = normalized(path.relative(root, absolute))
  const source = fs.readFileSync(absolute, 'utf8')
  if (writerPattern.test(source) && !source.includes('resolveStoragePath') && !source.includes('StorageResolver')) {
    if (allowlist.writerFiles[relative]) used.writerFiles.add(relative)
    else violations.push(`${relative}: persistence writer is not ASH-routed or narrowly allowlisted`)
  }
  if (homeCwdPattern.test(source)) {
    if (allowlist.homeAndCwdFiles[relative]) used.homeAndCwdFiles.add(relative)
    else violations.push(`${relative}: home/cwd path use is not narrowly allowlisted`)
  }
}

for (const absolute of literalFiles) {
  const relative = normalized(path.relative(root, absolute))
  const source = fs.readFileSync(absolute, 'utf8')
  const matches = forbidden.filter((rule) => { rule.pattern.lastIndex = 0; return rule.pattern.test(source) })
  if (!matches.length) continue
  if (allowlist.literalFiles[relative]) used.literalFiles.add(relative)
  else for (const rule of matches) violations.push(`${relative}: forbidden ${rule.name}`)
}

for (const category of ['writerFiles', 'homeAndCwdFiles', 'literalFiles']) {
  for (const [file, reason] of Object.entries(allowlist[category])) {
    if (typeof reason !== 'string' || reason.trim().length < 20) violations.push(`${file}: allowlist reason is missing or too broad`)
    if (!used[category].has(file)) violations.push(`${file}: stale ${category} allowlist entry`)
  }
}

if (violations.length) {
  console.error(`ASH storage audit failed (${violations.length} violation${violations.length === 1 ? '' : 's'}):`)
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`ASH storage audit passed (${files.length} production source files scanned).`)
}
