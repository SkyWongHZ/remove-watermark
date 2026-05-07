# API 接口设计

## 1. 接口原则

第一版 API 只服务本地图片去水印 MVP，采用同步处理模式。

前端提交原图和 mask 后，后端等待 IOPaint 处理完成，再返回结果图片地址。第一版不设计任务 ID、任务状态轮询、历史记录和数据库表。

## 2. 图片去水印接口

### POST /api/remove-watermark

提交原图和 mask，后端同步处理后返回输出图片地址。

请求类型：

```text
multipart/form-data
```

字段：

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| image | File | 是 | 原始图片，支持 JPG、PNG、WebP |
| mask | File | 是 | 黑白 mask PNG，尺寸必须与原图一致 |

mask 规则：

- 白色区域表示需要去除并修复。
- 黑色区域表示保留不变。
- mask 应由前端根据用户框选区域生成。
- 后端会以像素亮度 `128` 为阈值对 mask 做二值化：`>= 128` 视为白色修复区域，`< 128` 视为黑色保留区域。

成功响应：

```json
{
  "outputUrl": "/outputs/e8a9b0c1-xxxx-xxxx-xxxx-xxxxxxxxxxxx.png"
}
```

失败响应：

```json
{
  "error": {
    "code": "IMAGE_PROCESS_FAILED",
    "message": "图片处理失败"
  }
}
```

## 3. 结果图片访问

### GET /outputs/:filename

访问处理后的结果图片。

示例：

```text
GET /outputs/e8a9b0c1-xxxx-xxxx-xxxx-xxxxxxxxxxxx.png
```

后端通过 `@fastify/static` 将 `storage/outputs` 挂载到 `/outputs`。

文件规则：

- 输出文件名格式为 `${uuid}.png`。
- 第一版不自动清理输出文件。
- 如果本地磁盘占用过大，可以手动清空 `storage/uploads`、`storage/masks` 和 `storage/outputs`。

## 4. 错误码

| code | HTTP | 说明 |
| --- | --- | --- |
| INVALID_FILE_TYPE | 415 | 上传文件类型不支持 |
| IMAGE_REQUIRED | 400 | 缺少原图 |
| MASK_REQUIRED | 400 | 缺少 mask |
| MASK_SIZE_MISMATCH | 400 | mask 尺寸与原图尺寸不一致 |
| FILE_TOO_LARGE | 413 | 图片文件过大或图片尺寸超限 |
| SERVER_BUSY | 429 | 当前已有图片正在处理 |
| IOPAINT_NOT_INSTALLED | 503 | 本地未安装 IOPaint 或命令不可用 |
| IMAGE_PROCESS_FAILED | 500 | IOPaint 处理失败 |
| INTERNAL_ERROR | 500 | 其他后端错误 |

## 5. 文件格式限制

第一版支持输入：

- JPG
- PNG
- WebP

后端使用 `sharp` 将输入统一转换为 PNG 后交给 IOPaint。

第一版输出统一为：

- PNG

大小限制：

- 单文件大小：`<= 20MB`
- 图片最长边：`<= 4096px`
- 超过限制时返回 `FILE_TOO_LARGE`，HTTP 状态码为 `413`

第一版不支持：

- GIF
- HEIC
- TIFF
- RAW
- 视频文件

## 6. 请求处理流程

```text
1. 接收 multipart/form-data
2. 校验 image 是否存在
3. 校验 mask 是否存在
4. 校验 image 文件格式
5. 使用 sharp 读取原图尺寸
6. 使用 sharp 读取 mask 尺寸
7. 校验原图和 mask 尺寸一致
8. 校验文件大小和图片最长边
9. 将原图转换为 PNG 并保存到 storage/uploads
10. 将 mask 二值化后保存到 storage/masks
11. 调用 IOPaint CLI
12. 将输出文件保存到 storage/outputs
13. 返回 outputUrl
```

## 7. 同步处理说明

第一版使用同步接口，用户点击处理后需要等待接口返回。

优点：

- 接口最少。
- 前端状态简单。
- 不需要任务表。
- 不需要队列。

限制：

- 处理大图时请求会等待较久。
- 同一时间大量并发处理不适合。
- 服务重启后不会恢复未完成处理。

这些限制在本地单人 MVP 阶段可以接受。

第一版后端同一时间只处理 1 张图片。当前已有处理请求时，新请求返回 `SERVER_BUSY`，HTTP 状态码为 `429`；前端也应在处理期间禁用提交按钮。
