import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { execa } from "execa";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

type ErrorCode =
  | "INVALID_FILE_TYPE"
  | "IMAGE_REQUIRED"
  | "MASK_REQUIRED"
  | "MASK_SIZE_MISMATCH"
  | "FILE_TOO_LARGE"
  | "SERVER_BUSY"
  | "IOPAINT_NOT_INSTALLED"
  | "IMAGE_PROCESS_FAILED"
  | "INTERNAL_ERROR";

type UploadedFile = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

type RectFileMap = {
  image?: UploadedFile;
  mask?: UploadedFile;
};

class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const storageRoot = path.join(repoRoot, "storage");
const uploadDir = path.join(storageRoot, "uploads");
const maskDir = path.join(storageRoot, "masks");
const outputDir = path.join(storageRoot, "outputs");

const config = {
  port: Number(process.env.PORT ?? 3000),
  iopaintBin: process.env.IOPAINT_BIN
    ? path.resolve(process.env.IOPAINT_BIN)
    : path.join(repoRoot, ".venv/bin/iopaint"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 20),
  maxImageEdge: Number(process.env.MAX_IMAGE_EDGE ?? 4096)
};

const maxUploadBytes = config.maxUploadMb * 1024 * 1024;
const maxInputPixels = config.maxImageEdge * config.maxImageEdge;
const supportedFormats = new Set(["jpeg", "jpg", "png", "webp"]);

let isProcessing = false;

const app = Fastify({
  logger: true,
  bodyLimit: maxUploadBytes
});

await mkdir(uploadDir, { recursive: true });
await mkdir(maskDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

await app.register(multipart, {
  limits: {
    fileSize: maxUploadBytes,
    files: 2
  },
  throwFileSizeLimit: true
});

await app.register(fastifyStatic, {
  root: outputDir,
  prefix: "/outputs/"
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  if (statusCode === 413 || code === "FST_REQ_FILE_TOO_LARGE") {
    return reply.status(413).send({
      error: {
        code: "FILE_TOO_LARGE",
        message: `单文件大小不能超过 ${config.maxUploadMb}MB`
      }
    });
  }

  app.log.error(error);
  return reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "服务内部错误"
    }
  });
});

app.post("/api/remove-watermark", async (request, reply) => {
  if (isProcessing) {
    throw new ApiError("SERVER_BUSY", 429, "当前已有图片正在处理，请稍后再试");
  }

  isProcessing = true;
  try {
    const { image, mask } = await readUploadParts(request);
    if (!image) {
      throw new ApiError("IMAGE_REQUIRED", 400, "缺少原图");
    }
    if (!mask) {
      throw new ApiError("MASK_REQUIRED", 400, "缺少 mask");
    }

    const id = randomUUID();
    const inputPath = path.join(uploadDir, `${id}.png`);
    const maskPath = path.join(maskDir, `${id}.png`);
    const outputPath = path.join(outputDir, `${id}.png`);
    const rawOutputPath = path.join(outputDir, id);

    const normalizedImage = await normalizeImage(image.buffer);
    const normalizedMask = await normalizeMask(mask.buffer);

    if (
      normalizedImage.info.width !== normalizedMask.info.width ||
      normalizedImage.info.height !== normalizedMask.info.height
    ) {
      throw new ApiError(
        "MASK_SIZE_MISMATCH",
        400,
        "mask 尺寸与原图尺寸不一致"
      );
    }

    await writeFile(inputPath, normalizedImage.data);
    await writeFile(maskPath, normalizedMask.data);
    await runIopaint(inputPath, maskPath, rawOutputPath, outputPath);

    return reply.send({
      outputUrl: `/outputs/${id}.png`
    });
  } finally {
    isProcessing = false;
  }
});

await app.listen({
  host: "0.0.0.0",
  port: config.port
});

async function readUploadParts(request: FastifyRequest): Promise<RectFileMap> {
  const files: RectFileMap = {};

  for await (const part of request.parts()) {
    if (part.type !== "file") {
      continue;
    }

    if (part.fieldname !== "image" && part.fieldname !== "mask") {
      continue;
    }

    const buffer = await part.toBuffer();
    if (buffer.byteLength > maxUploadBytes) {
      throw new ApiError(
        "FILE_TOO_LARGE",
        413,
        `单文件大小不能超过 ${config.maxUploadMb}MB`
      );
    }

    files[part.fieldname] = {
      buffer,
      filename: part.filename,
      mimetype: part.mimetype
    };
  }

  return files;
}

async function normalizeImage(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.format || !supportedFormats.has(metadata.format)) {
    throw new ApiError("INVALID_FILE_TYPE", 415, "上传文件类型不支持");
  }

  ensureImageBounds(metadata.width, metadata.height);

  return sharp(buffer, { limitInputPixels: maxInputPixels })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function normalizeMask(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  ensureImageBounds(metadata.width, metadata.height);

  return sharp(buffer, { limitInputPixels: maxInputPixels })
    .flatten({ background: "#000000" })
    .grayscale()
    .threshold(128)
    .png()
    .toBuffer({ resolveWithObject: true });
}

function ensureImageBounds(width?: number, height?: number) {
  if (!width || !height) {
    throw new ApiError("INVALID_FILE_TYPE", 415, "无法读取图片尺寸");
  }

  if (Math.max(width, height) > config.maxImageEdge) {
    throw new ApiError(
      "FILE_TOO_LARGE",
      413,
      `图片最长边不能超过 ${config.maxImageEdge}px`
    );
  }
}

async function runIopaint(
  imagePath: string,
  maskPath: string,
  rawOutputPath: string,
  outputPath: string
) {
  try {
    await access(config.iopaintBin);
  } catch {
    throw new ApiError(
      "IOPAINT_NOT_INSTALLED",
      503,
      `未找到 IOPaint：${config.iopaintBin}`
    );
  }

  try {
    await execa(
      config.iopaintBin,
      [
        "run",
        "--model=lama",
        "--device=cpu",
        `--image=${imagePath}`,
        `--mask=${maskPath}`,
        `--output=${rawOutputPath}`
      ],
      {
        cwd: repoRoot,
        env: process.env,
        reject: true
      }
    );
  } catch (error) {
    app.log.error(error);
    throw new ApiError("IMAGE_PROCESS_FAILED", 500, "图片处理失败");
  }

  const iopaintOutputPath = path.join(rawOutputPath, path.basename(imagePath));
  try {
    const resultStats = await stat(iopaintOutputPath);
    if (!resultStats.isFile()) {
      throw new Error("IOPaint output is not a file");
    }
    await cp(iopaintOutputPath, outputPath);
    await rm(rawOutputPath, { recursive: true, force: true });
  } catch (error) {
    app.log.error(error);
    throw new ApiError("IMAGE_PROCESS_FAILED", 500, "图片处理失败");
  }
}
