# remove-watermark

本地图片去水印工具,pnpm monorepo —— `apps/web`(Vue 3 + Vite)+ `apps/server`(Fastify),图像处理走 Sharp + Python IOPaint。详细介绍见 [README.md](./README.md)。

## 协作工作流

- 一个任务 = 一个 issue;开发链路:`issue #N` → 分支 `issue-N-slug` → PR(body 含 `Closes #N`)→ merge 后 issue 自动关闭
- 合并默认用 **squash merge**:`gh pr merge <PR> --squash --delete-branch`
- commit body / PR body 用中文;标题中英文都行,简短即可

## 本地开发

- 前置:Node 20+、pnpm 10+、Python 3 venv 含 IOPaint(默认在 `.venv/bin/iopaint`)
- 启动:`pnpm dev`(并行起 server + web)
- **每个 PR 提交前必跑** `pnpm -r typecheck`

## 仓库约定

- `.claude/settings.local.json` 是个人本地配置,已 gitignore;`CLAUDE.md`(本文件)是团队共享约定
- `storage/uploads|masks|outputs/` 内容已 gitignore,只保留 `.gitkeep` 占位
