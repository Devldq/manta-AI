---
name: rag-detail-adaptive-width
overview: 将 rag/detail.tsx 中 loading 骨架屏容器的固定 max-w-4xl 改为 w-full 自适应宽度，与已修改的主容器保持一致。
todos:
  - id: fix-loading-width
    content: 将 loading 骨架屏容器（line 810）的 className 从 `p-6 max-w-4xl` 改为 `p-6 w-full`
    status: completed
---

将 rag 详情页 loading 骨架屏容器的固定宽度 `max-w-4xl` 改为 `w-full` 自适应宽度，与主容器保持一致的响应式效果。

## 修改内容

- **文件**: `packages/frontend/src/pages/rag/detail.tsx`
- **位置**: 第 810 行 loading 骨架屏容器
- **变更**: `className="p-6 max-w-4xl"` → `className="p-6 w-full"`
- **原因**: 主容器（line 840）已统一为 `w-full`，loading 状态容器需保持一致