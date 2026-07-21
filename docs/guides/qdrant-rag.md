# 本地 Qdrant RAG

Manta AI 的知识库向量数据使用 Qdrant。每个知识库对应一个独立 collection，默认名称为 `manta_kb_<knowledge-base-id>`，使用名为 `content` 的 Cosine dense vector。

## 启动 Qdrant

使用仓库的 Compose 配置会同时启动 Manta 和 Qdrant，并将向量数据持久化到 `qdrant-data` volume：

```bash
docker compose -f docker/docker-compose.yml up -d
```

本机开发也可以直接运行 Qdrant 官方二进制，默认 HTTP 地址为 `http://127.0.0.1:6333`。后端启动前必须先启动 Qdrant；连接失败时知识库创建会直接返回错误，不会创建只有元数据而没有 collection 的空知识库。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `QDRANT_URL` | `http://127.0.0.1:6333` | Qdrant REST API 地址 |
| `QDRANT_API_KEY` | 空 | 远程或受保护实例的 API Key |
| `QDRANT_COLLECTION_PREFIX` | `manta_kb_` | Manta collection 前缀 |

Embedding 模型决定新 collection 的向量维度。创建知识库后如需更换到不同维度的 Embedding 模型，应新建知识库并重新处理文档。

## 数据结构

- document point：保存文件名、MIME、大小、状态、hash 和分块数，不带向量。
- chunk point：保存文本、文档引用、分块位置和 `content` 向量。
- payload indexes：`record_type`、`document_id`、`source_sha256`。

删除文档会同步删除该文档的 document point 和所有 chunk point；删除知识库会删除整个 collection。
