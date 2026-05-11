# 本地图片去水印 MVP 技术方案

## 1. 项目目标

本项目第一版目标是实现一个本地单人使用的图片去水印工具。

用户在浏览器中上传图片，框选图片上的水印区域，前端生成对应的 mask 遮罩图，后端调用本地安装的 IOPaint 对图片进行修复，最后返回处理后的图片供用户预览和下载。

第一版重点是验证图片去水印效果和基础产品流程，不做视频处理、用户系统、数据库、任务队列和线上部署。

## 2. 核心流程

```text
Vue3 前端
  1. 上传原图
  2. 在图片上默认显示右下角矩形遮罩
  3. 用户拖拽、缩放遮罩，使其覆盖水印区域
  4. 前端生成与原图尺寸一致的黑白 mask PNG

Node/Fastify 后端
  5. 接收原图和 mask
  6. 保存到项目 storage 目录
  7. 必要时将 JPG/PNG/WebP 统一转换为 PNG
  8. 调用 IOPaint CLI 进行图片修复

IOPaint
  9. 根据 mask 中的白色区域修复原图
  10. 输出去水印后的 PNG 图片

Node/Fastify 后端
  11. 返回结果图片访问地址

Vue3 前端
  12. 展示处理结果
  13. 支持下载结果图片
```

## 3. 前端技术栈

- Vue 3
- Vite
- TypeScript
- Element Plus
- Canvas API
- axios

前端主要职责：

- 上传图片。
- 预览原图。
- 在图片上叠加矩形水印选择框。
- 支持拖拽和缩放矩形框。
- 根据矩形区域生成 mask PNG。
- 将原图和 mask 通过 `multipart/form-data` 提交给后端。
- 展示后端返回的处理结果。

## 4. 后端技术栈

- Node.js LTS
- TypeScript
- Fastify
- @fastify/multipart
- @fastify/static
- sharp
- execa

后端主要职责：

- 接收图片上传请求。
- 校验图片格式和文件大小。
- 保存原图、mask 和输出结果。
- 使用 `sharp` 做图片格式转换和尺寸校验。
- 使用 `execa` 调用 IOPaint CLI。
- 返回结果图片 URL。

后端通过环境变量 `IOPAINT_BIN` 定位 IOPaint 可执行文件。默认值为项目根目录下的 `./.venv/bin/iopaint`，因此后端启动时不依赖当前终端是否已经激活 Python 虚拟环境。

## 5. AI 图片修复引擎

第一版使用 IOPaint 的 LaMa 模型作为图片修复引擎。

IOPaint 作为独立的本地 Python 工具安装，不直接嵌入 Node 项目代码中。Node 后端只通过 CLI 调用它。

推荐调用方式：

```bash
./.venv/bin/iopaint run \
  --model=lama \
  --device=cpu \
  --image=<input.png> \
  --mask=<mask.png> \
  --output=<output.png>
```

当前机器是 Intel Mac，第一版默认使用 `--device=cpu`。后续如果换成 Apple Silicon 或有可用 GPU，再单独验证其他加速方式。

注意：CLI 模式下每次处理都会启动一次 IOPaint 并加载模型，CPU 环境下响应可能较慢，这属于预期行为。MVP 阶段优先保证流程简单稳定；如果后续体感不可接受，再评估切换到 IOPaint HTTP 服务模式。

## 6. Mask 规则

mask 是一张与原图尺寸一致的黑白 PNG 图片。

- 白色区域：需要去除并修复的区域。
- 黑色区域：保留不变的区域。

后端会对 mask 做二值化处理，像素亮度 `>= 128` 视为白色修复区域，`< 128` 视为黑色保留区域。前端 Canvas 导出的抗锯齿灰边不需要严格手动处理。

第一版只做矩形 mask：

- 默认出现在图片右下角。
- 支持拖拽位置。
- 支持缩放大小。
- 不做画笔涂抹。
- 不做自动识别水印。

## 7. 本地目录规划

```text
storage/
  uploads/   # 原始上传图片
  masks/     # 前端生成的 mask
  outputs/   # IOPaint 输出结果
```

第一版不做任务历史列表，但会保留输出文件，方便调试、预览和下载。输出文件统一命名为 `${uuid}.png`，后端通过 `@fastify/static` 将 `storage/outputs` 挂载到 `/outputs`，前端通过返回的 `outputUrl` 访问结果图片。

## 8. 第一版范围

第一版包含：

- 图片上传。
- JPG/PNG/WebP 输入。
- 矩形水印区域选择。
- 前端生成 mask。
- 后端同步调用 IOPaint CLI。
- 输出 PNG 结果。
- 浏览器预览和下载结果。
- 单文件大小限制为 `15MB`。
- 图片最长边限制为 `4096px`。
- 本地单人使用场景下，同一时间只处理 1 张图片；处理期间前端禁用提交按钮，后端也返回忙碌错误保护 CPU。

第一版不包含：

- 视频去水印。
- 自动识别水印。
- 画笔涂抹 mask。
- 用户登录。
- MySQL。
- Prisma。
- Redis。
- 任务队列。
- 线上部署。

## 9. 后续扩展方向

MVP 跑通后，可以按实际需要逐步扩展：

- 增加画笔和橡皮擦，让用户处理不规则水印。
- 增加任务记录和历史列表。
- 接入 MySQL + Prisma 保存任务元数据。
- 将同步接口改为异步任务接口。
- 支持批量图片处理。
- 评估 IOPaint HTTP 服务模式，减少重复启动 CLI 的开销。
- 调研视频去水印能力。
