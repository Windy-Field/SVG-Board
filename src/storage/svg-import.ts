import { Circle, Color, Ellipse, Line, Path, Polygon, Rect, loadSVGFromString } from "fabric";
import type { FabricObject } from "fabric";
import {
  createDocument,
  createShape,
  MAX_BOARD_SIZE,
  MAX_COORDINATE,
  MAX_NAME_LENGTH,
  MAX_PATH_LENGTH,
  MAX_POLYGON_POINTS,
  MAX_SHAPES,
  MAX_STROKE_WIDTH
} from "../core/model";
import type { BoardDocument, Shape, SvgImage } from "../core/types";
import { SVG_NAMESPACE, svgImageUrl } from "./svg-image";

// 这些图元的几何和样式可以用项目原有的对象属性表达
const EDITABLE_TAGS = new Set([
  "rect",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "path",
  "title",
  "desc"
]);
const EDITABLE_ATTRIBUTES = new Set([
  "id",
  "xmlns",
  "xmlns:xlink",
  "version",
  "width",
  "height",
  "viewBox",
  "x",
  "y",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "x2",
  "y1",
  "y2",
  "points",
  "d",
  "fill",
  "stroke",
  "stroke-width",
  "opacity"
]);

/** 判断整张图能否拆分，复杂样式或结构交给浏览器按原图显示 */
function canEditShapes(root: Element): boolean {
  const elements = [root];
  for (const child of root.querySelectorAll("*")) {
    elements.push(child);
  }
  for (const element of elements) {
    if (
      element !== root &&
      (element.namespaceURI !== SVG_NAMESPACE || !EDITABLE_TAGS.has(element.localName))
    ) {
      return false;
    }
    for (const attribute of element.attributes) {
      if (!EDITABLE_ATTRIBUTES.has(attribute.name)) {
        return false;
      }
      if (attribute.name === "fill" || attribute.name === "stroke") {
        const color = attribute.value.trim();
        if (color === "none") {
          continue;
        }
        const paint = new Color(color);
        if (paint.isUnrecognised || paint.getAlpha() !== 1) {
          return false;
        }
      }
    }
  }
  return true;
}

/** 将可理解的纯色转换成项目里统一使用的六位十六进制颜色 */
function readPaint(value: unknown): string {
  if (typeof value !== "string" || value === "" || value === "none") {
    return "none";
  }
  const color = new Color(value);
  const hex = color.toHex();
  return "#" + hex.toLowerCase();
}

/** 将 Fabric 解析出的一个图元转换为可编辑对象，无法准确表示时返回 null */
function convertObject(object: FabricObject, layer: number): Shape | null {
  const center = object.getCenterPoint();
  const width = object.width * object.scaleX;
  const height = object.height * object.scaleY;
  const shape = createShape("rect", { x: center.x - width / 2, y: center.y - height / 2 });
  shape.width = width;
  shape.height = height;
  shape.stroke = readPaint(object.stroke);
  shape.fill = readPaint(object.fill);
  shape.strokeWidth = object.strokeWidth * Math.abs(object.scaleX);
  shape.opacity = object.opacity;
  shape.layer = layer;
  if (object instanceof Rect) {
    if (object.rx * object.scaleX !== object.ry * object.scaleY) {
      return null;
    }
    shape.cornerRadius = object.rx * object.scaleX;
  } else if (object instanceof Circle || object instanceof Ellipse) {
    shape.kind = "ellipse";
    shape.name = "椭圆";
  } else if (object instanceof Line) {
    shape.kind = "line";
    shape.name = "线段";
    const endpoints = object.calcLinePoints();
    shape.x = center.x + endpoints.x1 * object.scaleX;
    shape.y = center.y + endpoints.y1 * object.scaleY;
    shape.width = (endpoints.x2 - endpoints.x1) * object.scaleX;
    shape.height = (endpoints.y2 - endpoints.y1) * object.scaleY;
  } else if (object instanceof Polygon && object.points.length <= MAX_POLYGON_POINTS) {
    shape.kind = "polygon";
    shape.name = "多边形";
    for (const point of object.points) {
      shape.points.push({ x: point.x, y: point.y });
    }
  } else if (object instanceof Path) {
    shape.kind = "path";
    shape.name = "SVG 路径";
    const commands: string[] = [];
    for (const part of object.path) {
      commands.push(part.join(" "));
    }
    shape.path = commands.join(" ");
  } else {
    return null;
  }
  if (shape.path.length > MAX_PATH_LENGTH || shape.strokeWidth > MAX_STROKE_WIDTH) {
    return null;
  }
  for (const value of [shape.x, shape.y, shape.width, shape.height]) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
      return null;
    }
  }
  return shape;
}

/** 只解析受支持的图元，任何一个无法转换时保留整图 */
async function readEditableShapes(root: Element, source: string): Promise<Shape[]> {
  if (!canEditShapes(root)) {
    return [];
  }
  const result = await loadSVGFromString(source);
  const shapes: Shape[] = [];
  let complete = result.objects.length <= MAX_SHAPES;
  for (const object of result.objects) {
    if (object === null) {
      complete = false;
      continue;
    }
    if (complete) {
      const shape = convertObject(object, shapes.length);
      if (shape === null) {
        complete = false;
      } else {
        shapes.push(shape);
      }
    }
    object.dispose();
  }
  if (!complete) {
    return [];
  }
  return shapes;
}

/** 以浏览器图片模式读取 SVG 比例，并限制新对象的显示尺寸 */
async function readImage(source: string, root: Element): Promise<SvgImage> {
  const element = new Image();
  element.src = svgImageUrl({ source: source, width: 1, height: 1 });
  await element.decode();
  let width = element.naturalWidth;
  let height = element.naturalHeight;
  const viewBox = root.getAttribute("viewBox");
  if (viewBox !== null && !root.hasAttribute("width") && !root.hasAttribute("height")) {
    const trimmed = viewBox.trim();
    const parts = trimmed.split(/[\s,]+/);
    const viewWidth = Number(parts[2]);
    const viewHeight = Number(parts[3]);
    if (
      parts.length === 4 &&
      viewWidth > 0 &&
      viewHeight > 0 &&
      Number.isFinite(viewWidth) &&
      Number.isFinite(viewHeight)
    ) {
      width = viewWidth;
      height = viewHeight;
    }
  }
  const scale = Math.min(1, MAX_BOARD_SIZE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  // 明确图片的内部尺寸，使只有 viewBox 的 SVG 在画布和导出中使用同一比例
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const normalized = new XMLSerializer().serializeToString(root);
  return { source: normalized, width: width, height: height };
}

/** 将普通 SVG 打开为新作品，复杂文件仍可整体移动、缩放和导出 */
export async function importSvg(root: Element, filename: string): Promise<BoardDocument> {
  const board = createDocument();
  const name = filename.replace(/\.svg$/i, "");
  board.name = name.slice(0, MAX_NAME_LENGTH);
  const source = new XMLSerializer().serializeToString(root);
  try {
    board.shapes = await readEditableShapes(root, source);
  } catch {
    // 图元转换不完整时使用原图，不丢弃画面的一部分
  }
  if (board.shapes.length === 0) {
    const image = await readImage(source, root);
    const shape = createShape("svg-image", { x: 0, y: 0 });
    shape.svgImage = image;
    shape.width = image.width;
    shape.height = image.height;
    shape.strokeWidth = 0;
    board.shapes.push(shape);
  }
  return board;
}
