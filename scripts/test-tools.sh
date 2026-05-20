#!/bin/bash
# 工具测试脚本 — 验证 fs-tools 的各种调用场景

BASE_URL="http://localhost:3000/api/tools/test"

echo "======================================"
echo "  工具 API 集成测试"
echo "======================================"

echo ""
echo "[1] 测试 lsDir — dir_path 参数"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"dir_path":"/Users/link/dev/arm"}}' \
  | jq '.result.count, .result.items[:3]' 2>/dev/null || echo "请求失败"

echo ""
echo "[2] 测试 lsDir — path 参数"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"path":"/Users/link/dev/arm/core"}}' \
  | jq '.result.count' 2>/dev/null || echo "请求失败"

echo ""
echo "[3] 测试 lsDir — directory 参数"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"directory":"/tmp"}}' \
  | jq '.result.count, .result.items[:2]' 2>/dev/null || echo "请求失败"

echo ""
echo "[4] 测试 lsDir — 无参数（应报错）"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{}}' \
  | jq '.result' 2>/dev/null || echo "请求失败"

echo ""
echo "[5] 测试 glob"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"glob","input":{"pattern":"**/*.ts","root":"/Users/link/dev/arm/core"}}' \
  | jq '.result.count, .result.files[:3]' 2>/dev/null || echo "请求失败"

echo ""
echo "[6] 测试 readFile"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"readFile","input":{"file_path":"/Users/link/dev/arm/AGENTS.md"}}' \
  | jq '{totalLines: .result.totalLines, offset: .result.offset}' 2>/dev/null || echo "请求失败"

echo ""
echo "[7] 测试 readFile 带 offset 和 limit"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"readFile","input":{"file_path":"/Users/link/dev/arm/AGENTS.md","offset":1,"limit":5}}' \
  | jq '{totalLines: .result.totalLines, offset: .result.offset, limit: .result.limit, content: .result.content[:50]}' 2>/dev/null || echo "请求失败"

echo ""
echo "[8] 测试 grep"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"grep","input":{"pattern":"lsDir","root":"/Users/link/dev/arm/core"}}' \
  | jq '.result.total, .result.results[:2]' 2>/dev/null || echo "请求失败"

echo ""
echo "[9] 测试不存在的工具"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"nonexistentTool","input":{}}' \
  | jq '.' 2>/dev/null || echo "请求失败"

echo ""
echo "[10] 测试不存在的目录"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"dir_path":"/nonexistent/path"}}' \
  | jq '.result' 2>/dev/null || echo "请求失败"

echo ""
echo "======================================"
echo "  测试完成"
echo "======================================"
