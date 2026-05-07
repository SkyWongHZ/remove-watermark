# remove-watermark

本地图片去水印工具 —— pnpm monorepo,Vue 3 前端 + Fastify 后端,图像处理结合 Sharp 与 Python。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3.5 + Vite 6 + Element Plus + axios |
| 后端 | Fastify 5 + `@fastify/multipart` + `@fastify/static` |
| 图像处理 | Sharp(Node 端)+ Python(通过 `execa` 调用) |
| 语言 | TypeScript 5.9 |
| 包管理 | pnpm 10.8 (workspace) |

## 项目结构

```
.
├── apps/
│   ├── web/        # 前端,Vite dev 端口 5173
│   └── server/     # 后端,Fastify,Python 调用层
├── docs/           # 中文设计文档
├── storage/        # 运行时数据(已 gitignore,仅保留 .gitkeep)
│   ├── uploads/
│   ├── masks/
│   └── outputs/
└── pnpm-workspace.yaml
```

## 快速启动

前置:Node 20+、pnpm 10+、Python 3(用于图像处理脚本,需自行准备 venv 与依赖)。

```bash
pnpm install

# 一键启前后端
pnpm dev

# 或分开启
pnpm dev:web      # 前端 http://localhost:5173
pnpm dev:server   # 后端
```

## 限制

- **单张图片上传上限:15 MB**(前后端双校验,超限会被拦截并提示)。后端可通过环境变量 `MAX_UPLOAD_BYTES` 调整,前端常量在 `apps/web/src/App.vue` 顶部 `MAX_UPLOAD_BYTES`。

## 文档

详细设计与本地搭建说明见 `docs/`:

- [本地图片去水印 MVP 技术方案](docs/本地图片去水印MVP技术方案.md)
- [本地安装与运行指南](docs/本地安装与运行指南.md)
- [API 接口设计](docs/API接口设计.md)

## License

MIT
