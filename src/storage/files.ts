import { MAX_FILE_BYTES, parseDocument } from "./document";
import { StaticCanvas } from "fabric";
import { createFabricLabel, createFabricShape } from "../canvas/fabric-shapes";
import { updateRelations } from "../geometry/geometry";
import { compareLayers } from "../core/model";
import type { BoardDocument, Bounds, Shape } from "../core/types";
import { prepareDocument, contentBounds, visualBounds } from "./content";
import { importSvg } from "./svg-import";
import { SVG_NAMESPACE } from "./svg-image";

// 导出图形四周留白，单位为画布坐标
const EXPORT_PADDING = 32;
// PNG 默认分辨率倍率
const PNG_SCALE = 2;
// PNG 任意一边的最大像素数
const MAX_PNG_SIZE = 8192;
// 下载开始后释放临时地址的等待时间，单位为毫秒
const DOWNLOAD_RELEASE_DELAY = 1000;

/** 控制导出内容，辅助对象和背景不影响原始项目文件 */
export interface ExportOptions {
  crop: boolean;
  transparent: boolean;
  hideAuxiliary: boolean;
  area?: Bounds;
  includeProject?: boolean;
}

/** 生成独立 SVG，并嵌入经过校验的项目元数据以便再次编辑 */
export function createSvg(document: BoardDocument, options: ExportOptions): string {
  const invalid = updateRelations(document);
  const visible: Shape[] = [];
  for (const shape of document.shapes) {
    if (shape.hidden || invalid.has(shape.id)) {
      continue;
    }
    if (options.hideAuxiliary && shape.auxiliary) {
      continue;
    }
    visible.push(shape);
  }
  const bounds = exportBounds(document, visible, options);
  // 只生成 SVG 字符串，不需要为整个导出范围分配像素画布
  const canvas = new StaticCanvas(undefined, { width: 1, height: 1, renderOnAddRemove: false });
  if (!options.transparent) {
    canvas.backgroundColor = document.background;
  }
  visible.sort(compareLayers);
  for (const shape of visible) {
    canvas.add(createFabricShape(shape, bounds));
    const label = createFabricLabel(shape);
    if (label !== null) {
      canvas.add(label);
    }
  }
  const svg = canvas.toSVG({
    suppressPreamble: true,
    viewBox: bounds,
    width: String(bounds.width),
    height: String(bounds.height)
  });
  canvas.destroy();
  if (options.includeProject === false) {
    return svg;
  }
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
  const metadata = xml.createElementNS(SVG_NAMESPACE, "metadata");
  metadata.setAttribute("id", "svg-board-project");
  metadata.textContent = JSON.stringify(prepareDocument(document));
  xml.documentElement.prepend(metadata);
  return new XMLSerializer().serializeToString(xml.documentElement);
}

/** 使用指定区域，或围绕可见对象计算带留白的导出边界 */
function exportBounds(document: BoardDocument, visible: Shape[], options: ExportOptions): Bounds {
  if (options.area !== undefined) {
    return options.area;
  }
  if (options.crop) {
    const visibleBounds = visualBounds(visible);
    if (visibleBounds !== null) {
      return {
        x: visibleBounds.x - EXPORT_PADDING,
        y: visibleBounds.y - EXPORT_PADDING,
        width: Math.max(1, visibleBounds.width + EXPORT_PADDING * 2),
        height: Math.max(1, visibleBounds.height + EXPORT_PADDING * 2)
      };
    }
  }
  return contentBounds(document);
}

/** 下载二进制内容，使用独立链接并延迟回收地址 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  /** 下载开始后释放临时地址，不保留额外的浏览器资源 */
  function releaseUrl(): void {
    URL.revokeObjectURL(url);
  }
  window.setTimeout(releaseUrl, DOWNLOAD_RELEASE_DELAY);
}

/** 将文件名中的路径字符替换掉，保留用户给作品起的名称 */
export function getFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (cleaned.trim() === "") {
    return "untitled";
  }
  return cleaned;
}

/** 下载完整项目，图形关系和辅助对象均保留 */
export function saveProject(document: BoardDocument): void {
  const text = JSON.stringify(prepareDocument(document), null, 2);
  downloadBlob(
    new Blob([text], { type: "application/json" }),
    getFileName(document.name) + ".svgboard.json"
  );
}

/** 优先恢复项目数据，普通 SVG 按图元或整图导入 */
export async function openProject(file: File): Promise<BoardDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("文件不能超过 8 MB");
  }
  const text = await file.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    const xml = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = xml.documentElement;
    if (
      root.localName !== "svg" ||
      (root.namespaceURI !== SVG_NAMESPACE && root.namespaceURI !== null)
    ) {
      throw new Error("SVG 文件格式损坏");
    }
    const metadata = root.querySelector(":scope > metadata#svg-board-project");
    if (metadata !== null && metadata.textContent !== null) {
      return parseDocument(metadata.textContent);
    }
    if (root.namespaceURI === null) {
      root.setAttribute("xmlns", SVG_NAMESPACE);
    }
    return importSvg(root, file.name);
  }
  return parseDocument(text);
}

/** 将 SVG 绘制到离屏画布，完成后下载 PNG，加载失败时保留作品 */
export async function exportPng(svg: string, name: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    const scale = Math.min(PNG_SCALE, MAX_PNG_SIZE / image.width, MAX_PNG_SIZE / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(image.width * scale));
    canvas.height = Math.max(1, Math.ceil(image.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("PNG 导出不可用，请导出 SVG");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    /** 接收浏览器生成的 PNG，失败时交给 Promise 报错 */
    function createPng(resolve: (value: void) => void, reject: (reason: Error) => void): void {
      /** 检查图片是否成功编码，成功后发起下载 */
      function handleBlob(blob: Blob | null): void {
        if (blob === null) {
          reject(new Error("PNG 编码失败，请重试或导出 SVG"));
          return;
        }
        downloadBlob(blob, getFileName(name) + ".png");
        resolve();
      }
      canvas.toBlob(handleBlob, "image/png");
    }
    await new Promise<void>(createPng);
  } finally {
    URL.revokeObjectURL(url);
  }
}
