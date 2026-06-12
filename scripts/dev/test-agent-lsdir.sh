#!/bin/bash
# 模拟 AI 模型调用 lsDir 工具

echo "======================================"
echo "  模拟 AI 调用 lsDir"
echo "======================================"

# 1. 测试正常调用（作为参考）
echo ""
echo "[1] 正常参数格式:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"dir_path":"/Users/link/dev/workSpace/esp/ad-create-comps"}}' \
  | jq '.result.count'

# 2. 模拟 AI 可能调用的格式
echo ""
echo "[2] 测试各种 AI 可能传递的格式:"

# 格式 A: args 是 JSON 字符串
echo "  A) args=JSON 字符串:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"args":"{\"dir_path\":\"/Users/link/dev/workSpace/esp/ad-create-comps\"}"}}' \
  | jq '.result.count'

# 格式 B: input 是 JSON 字符串  
echo "  B) input=JSON 字符串:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"input":"{\"dir_path\":\"/Users/link/dev/workSpace/esp/ad-create-comps\"}"}}' \
  | jq '.result.count'

# 格式 C: 直接字符串路径
echo "  C) 直接字符串路径:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":"/Users/link/dev/workSpace/esp/ad-create-comps"}' \
  | jq '.result.count'

# 格式 D: 路径放在 name 字段
echo "  D) path 作为独立字段:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"name":"/Users/link/dev/workSpace/esp/ad-create-comps"}}' \
  | jq '.result.error'

# 格式 E: 只有一个 value 字段
echo "  E) value 字段:"
curl -s -X POST http://localhost:3000/api/tools/test \
  -H "Content-Type: application/json" \
  -d '{"toolName":"lsDir","input":{"value":"/Users/link/dev/workSpace/esp/ad-create-comps"}}' \
  | jq '.result.error'

echo ""
echo "======================================"
echo "  如果所有测试都返回错误，说明"
echo "  AI 模型没有正确传递 dir_path 参数"
echo "======================================"
