<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <h1>本地图片去水印</h1>
        <p>IOPaint CLI · 矩形遮罩 · PNG 输出</p>
      </div>
      <div class="topbar-actions">
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          @change="handleFileChange"
        />
        <el-button :icon="Upload" type="primary" @click="openFilePicker">
          选择图片
        </el-button>
        <el-button :icon="RefreshLeft" :disabled="!sourceUrl" @click="resetRect">
          重置遮罩
        </el-button>
      </div>
    </header>

    <main class="workspace">
      <section class="editor-panel">
        <div class="panel-header">
          <div>
            <strong>原图</strong>
            <span v-if="naturalSize.width">
              {{ naturalSize.width }} x {{ naturalSize.height }}
            </span>
          </div>
          <el-tag v-if="sourceFile" effect="plain" round>{{ sourceFile.name }}</el-tag>
        </div>

        <div class="image-stage" :class="{ empty: !sourceUrl }">
          <button v-if="!sourceUrl" class="empty-picker" type="button" @click="openFilePicker">
            <Upload class="empty-icon" />
            <span>选择图片</span>
          </button>

          <div v-else class="image-wrap">
            <img
              ref="imageEl"
              class="source-image"
              :src="sourceUrl"
              alt="待处理图片"
              @load="handleImageLoad"
            />
            <div
              class="mask-rect"
              :style="rectStyle"
              @pointerdown="startDrag('move', $event)"
            >
              <span
                v-for="handle in resizeHandles"
                :key="handle"
                class="resize-handle"
                :class="handle"
                @pointerdown.stop="startDrag(handle, $event)"
              />
            </div>
          </div>
        </div>
      </section>

      <aside class="side-panel">
        <section class="control-section">
          <div class="panel-header compact">
            <strong>遮罩区域</strong>
          </div>

          <div class="number-grid">
            <label>
              <span>X</span>
              <el-input-number
                v-model="rect.x"
                :min="0"
                :max="xInputMax"
                :disabled="!sourceUrl"
                controls-position="right"
                @change="clampRect"
              />
            </label>
            <label>
              <span>Y</span>
              <el-input-number
                v-model="rect.y"
                :min="0"
                :max="yInputMax"
                :disabled="!sourceUrl"
                controls-position="right"
                @change="clampRect"
              />
            </label>
            <label>
              <span>W</span>
              <el-input-number
                v-model="rect.width"
                :min="widthInputMin"
                :max="widthInputMax"
                :disabled="!sourceUrl"
                controls-position="right"
                @change="clampRect"
              />
            </label>
            <label>
              <span>H</span>
              <el-input-number
                v-model="rect.height"
                :min="heightInputMin"
                :max="heightInputMax"
                :disabled="!sourceUrl"
                controls-position="right"
                @change="clampRect"
              />
            </label>
          </div>

          <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" />

          <el-button
            class="primary-action"
            :icon="MagicStick"
            type="primary"
            size="large"
            :loading="processing"
            :disabled="!canSubmit"
            @click="submitImage"
          >
            处理图片
          </el-button>
        </section>

        <section class="result-section">
          <div class="panel-header compact">
            <strong>结果</strong>
            <el-button
              v-if="resultUrl"
              :icon="Download"
              text
              type="primary"
              @click="downloadResult"
            >
              下载
            </el-button>
          </div>
          <div class="result-preview" :class="{ empty: !resultUrl }">
            <img v-if="resultUrl" :src="resultUrl" alt="处理结果" />
            <span v-else>暂无结果</span>
          </div>
        </section>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { Download, MagicStick, RefreshLeft, Upload } from "@element-plus/icons-vue";
import axios from "axios";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type DragMode = "move" | ResizeHandle;
type MaskRect = { x: number; y: number; width: number; height: number };

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024);

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || ""
});

const fileInput = ref<HTMLInputElement | null>(null);
const imageEl = ref<HTMLImageElement | null>(null);
const sourceFile = ref<File | null>(null);
const sourceUrl = ref("");
const resultUrl = ref("");
const errorMessage = ref("");
const processing = ref(false);

const naturalSize = reactive({ width: 0, height: 0 });
const renderSize = reactive({ width: 0, height: 0 });
const rect = reactive({ x: 0, y: 0, width: 0, height: 0 });

const minRectSize = 24;
const resizeHandles: ResizeHandle[] = ["nw", "ne", "sw", "se"];
let objectUrl = "";

let dragState:
  | {
      mode: DragMode;
      startX: number;
      startY: number;
      startRect: MaskRect;
      scaleX: number;
      scaleY: number;
    }
  | null = null;

const hasLoadedImage = computed(() => naturalSize.width > 0 && naturalSize.height > 0);
const xInputMax = computed(() => Math.max(0, naturalSize.width - rect.width));
const yInputMax = computed(() => Math.max(0, naturalSize.height - rect.height));
const widthInputMin = computed(() => (hasLoadedImage.value ? Math.min(minRectSize, naturalSize.width) : 0));
const heightInputMin = computed(() => (hasLoadedImage.value ? Math.min(minRectSize, naturalSize.height) : 0));
const widthInputMax = computed(() => Math.max(widthInputMin.value, naturalSize.width));
const heightInputMax = computed(() => Math.max(heightInputMin.value, naturalSize.height));
const canSubmit = computed(
  () =>
    Boolean(sourceFile.value && sourceUrl.value && hasLoadedImage.value && rect.width && rect.height) &&
    !processing.value
);

const rectStyle = computed(() => {
  if (!naturalSize.width || !naturalSize.height || !renderSize.width || !renderSize.height) {
    return {};
  }

  return {
    left: `${(rect.x / naturalSize.width) * renderSize.width}px`,
    top: `${(rect.y / naturalSize.height) * renderSize.height}px`,
    width: `${(rect.width / naturalSize.width) * renderSize.width}px`,
    height: `${(rect.height / naturalSize.height) * renderSize.height}px`
  };
});

onMounted(() => {
  window.addEventListener("resize", updateRenderSize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateRenderSize);
  stopDrag();
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
});

function openFilePicker() {
  fileInput.value?.click();
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    errorMessage.value = "仅支持 JPG、PNG、WebP 图片";
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    errorMessage.value = `图片超过 ${MAX_UPLOAD_MB}MB 上限,请压缩后重试`;
    return;
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  errorMessage.value = "";
  resultUrl.value = "";
  sourceFile.value = file;
  objectUrl = URL.createObjectURL(file);
  sourceUrl.value = objectUrl;
}

async function handleImageLoad() {
  const image = imageEl.value;
  if (!image) {
    return;
  }

  naturalSize.width = image.naturalWidth;
  naturalSize.height = image.naturalHeight;
  resetRect();
  await nextTick();
  updateRenderSize();
}

function updateRenderSize() {
  const image = imageEl.value;
  if (!image) {
    renderSize.width = 0;
    renderSize.height = 0;
    return;
  }

  const box = image.getBoundingClientRect();
  renderSize.width = box.width;
  renderSize.height = box.height;
}

function resetRect() {
  if (!naturalSize.width || !naturalSize.height) {
    return;
  }

  const width = Math.max(minRectSize, Math.round(naturalSize.width * 0.26));
  const height = Math.max(minRectSize, Math.round(naturalSize.height * 0.14));
  const marginX = Math.round(naturalSize.width * 0.04);
  const marginY = Math.round(naturalSize.height * 0.04);

  rect.width = Math.min(width, naturalSize.width);
  rect.height = Math.min(height, naturalSize.height);
  rect.x = Math.max(0, naturalSize.width - rect.width - marginX);
  rect.y = Math.max(0, naturalSize.height - rect.height - marginY);
}

function startDrag(mode: DragMode, event: PointerEvent) {
  if (!sourceUrl.value || !renderSize.width || !renderSize.height) {
    return;
  }

  event.preventDefault();
  dragState = {
    mode,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...rect },
    scaleX: naturalSize.width / renderSize.width,
    scaleY: naturalSize.height / renderSize.height
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopDrag);
}

function handlePointerMove(event: PointerEvent) {
  if (!dragState) {
    return;
  }

  const dx = Math.round((event.clientX - dragState.startX) * dragState.scaleX);
  const dy = Math.round((event.clientY - dragState.startY) * dragState.scaleY);
  const next = { ...dragState.startRect };

  if (dragState.mode === "move") {
    next.x += dx;
    next.y += dy;
  } else {
    if (dragState.mode.includes("w")) {
      next.x += dx;
      next.width -= dx;
    }
    if (dragState.mode.includes("e")) {
      next.width += dx;
    }
    if (dragState.mode.includes("n")) {
      next.y += dy;
      next.height -= dy;
    }
    if (dragState.mode.includes("s")) {
      next.height += dy;
    }
  }

  rect.x = next.x;
  rect.y = next.y;
  rect.width = next.width;
  rect.height = next.height;
  clampRect();
}

function stopDrag() {
  dragState = null;
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", stopDrag);
}

function clampRect() {
  if (!hasLoadedImage.value) {
    rect.x = 0;
    rect.y = 0;
    rect.width = 0;
    rect.height = 0;
    return;
  }

  rect.width = Math.max(widthInputMin.value, Math.min(Math.round(rect.width), naturalSize.width));
  rect.height = Math.max(heightInputMin.value, Math.min(Math.round(rect.height), naturalSize.height));
  rect.x = Math.max(0, Math.min(Math.round(rect.x), naturalSize.width - rect.width));
  rect.y = Math.max(0, Math.min(Math.round(rect.y), naturalSize.height - rect.height));
}

async function submitImage() {
  if (!sourceFile.value || processing.value) {
    return;
  }

  processing.value = true;
  errorMessage.value = "";
  resultUrl.value = "";

  try {
    const mask = await createMaskBlob();
    const formData = new FormData();
    formData.append("image", sourceFile.value);
    formData.append("mask", mask, "mask.png");

    const response = await api.post<{ outputUrl: string }>("/api/remove-watermark", formData);
    resultUrl.value = withCacheBuster(response.data.outputUrl);
  } catch (error) {
    errorMessage.value = readErrorMessage(error);
  } finally {
    processing.value = false;
  }
}

function createMaskBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;

    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("无法创建 mask"));
      return;
    }

    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height)
    );

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("无法导出 mask"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function withCacheBuster(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

function readErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as { error?: { message?: string } } | undefined;
    return payload?.error?.message ?? "请求失败";
  }

  return error instanceof Error ? error.message : "处理失败";
}

function downloadResult() {
  if (!resultUrl.value) {
    return;
  }

  const link = document.createElement("a");
  link.href = resultUrl.value;
  link.download = "remove-watermark-result.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
</script>
