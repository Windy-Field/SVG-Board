import {
  MAX_PATH_LENGTH,
  MAX_SHAPES,
  MAX_COORDINATE,
  MIN_BOARD_SIZE,
  MAX_BOARD_SIZE
} from "../core/model";
import type { BoardDocument, Relation, Shape, ShapeKind } from "../core/types";
import { isFont } from "../ui/fonts";
import { createDocument, DEFAULT_BACKGROUND } from "../core/model";
import { convertPointLabels } from "../objects/point-labels";
import {
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_POINT_RADIUS,
  DEFAULT_POLYGON_SIDES
} from "../core/model";
import {
  MAX_POINT_RADIUS,
  MAX_CORNER_RADIUS,
  MIN_POLYGON_SIDES,
  MAX_POLYGON_POINTS,
  MAX_BEND_RATIO
} from "../core/model";
import {
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_ROTATION,
  MAX_STROKE_WIDTH
} from "../core/model";

// 项目文件大小上限，单位为字节
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
// 浏览器自动恢复作品的存储键
export const STORAGE_KEY = "svg-board-document-v1";

/** 判断未知输入是否为普通对象，方便安全读取文件内容 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取有长度上限的字符串，不符合条件时拒绝整个文件 */
function readString(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) {
    throw new Error("文件中的文字或编号不符合格式要求");
  }
  return value;
}

/** 读取有限数值并检查范围，避免异常坐标导致画布失效 */
function readNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("文件包含无效的数值");
  }
  if (value < minimum || value > maximum) {
    throw new Error("文件中的尺寸或坐标超出允许范围");
  }
  return value;
}

/** 读取布尔值，不把字符串等输入隐式转换为开关状态 */
function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("文件中的对象状态不符合格式要求");
  }
  return value;
}

/** 仅接受编辑器支持的对象类型 */
function readKind(value: unknown): ShapeKind {
  if (
    value === "rect" ||
    value === "ellipse" ||
    value === "diamond" ||
    value === "line" ||
    value === "arrow" ||
    value === "polygon" ||
    value === "curve"
  ) {
    return value;
  }
  if (value === "pencil" || value === "text" || value === "point" || value === "connector") {
    return value;
  }
  throw new Error("文件包含不支持的图形类型");
}

/** 颜色只允许十六进制或无填充，禁止导入外部资源链接 */
function readColor(value: unknown): string {
  const color = readString(value, 16);
  if (color === "none" || /^#[0-9a-f]{6}$/i.test(color)) {
    return color;
  }
  throw new Error("文件包含不支持的颜色格式");
}

/** 将未知对象逐字段转换为图形，不直接信任 JSON 中的类型 */
function readShape(value: unknown): Shape {
  if (!isRecord(value) || !isRecord(value.relation)) {
    throw new Error("文件缺少图形或构造信息");
  }
  const relationKind = value.relation.kind;
  if (
    relationKind !== "none" &&
    relationKind !== "connector" &&
    relationKind !== "segment" &&
    relationKind !== "midpoint" &&
    relationKind !== "intersection" &&
    relationKind !== "parallel" &&
    relationKind !== "perpendicular" &&
    relationKind !== "label"
  ) {
    throw new Error("文件包含不支持的构造关系");
  }
  if (!Array.isArray(value.relation.sources) || value.relation.sources.length > 2) {
    throw new Error("构造来源数量不正确");
  }
  const sources: string[] = [];
  for (const source of value.relation.sources) {
    sources.push(readString(source, 80));
  }
  const path = readString(value.path, MAX_PATH_LENGTH);
  if (!/^[MLQCHVZmlqchvz0-9eE.,\s+\-]*$/.test(path)) {
    throw new Error("画笔路径包含不支持的指令");
  }
  const fontFamily = readString(value.fontFamily, 80);
  if (!isFont(fontFamily)) {
    throw new Error("文件包含不支持的字体");
  }
  const textAlign = readString(value.textAlign, 10);
  if (textAlign !== "start" && textAlign !== "middle" && textAlign !== "end") {
    throw new Error("文字对齐格式不正确");
  }
  const relation: Relation = { kind: relationKind, sources: sources };
  const points = [];
  if (value.points !== undefined) {
    if (!Array.isArray(value.points) || value.points.length > MAX_POLYGON_POINTS) {
      throw new Error("多边形顶点过多");
    }
    for (const point of value.points) {
      if (!isRecord(point)) {
        throw new Error("顶点格式无效");
      }
      points.push({
        x: readNumber(point.x, -MAX_COORDINATE, MAX_COORDINATE),
        y: readNumber(point.y, -MAX_COORDINATE, MAX_COORDINATE)
      });
    }
  }
  if (relationKind === "label") {
    relation.offsetX = readNumber(value.relation.offsetX, -MAX_COORDINATE, MAX_COORDINATE);
    relation.offsetY = readNumber(value.relation.offsetY, -MAX_COORDINATE, MAX_COORDINATE);
  }
  if (
    relationKind === "segment" ||
    relationKind === "parallel" ||
    relationKind === "perpendicular"
  ) {
    if (value.relation.startOffset !== undefined) {
      relation.startOffset = readNumber(
        value.relation.startOffset,
        -MAX_COORDINATE,
        MAX_COORDINATE
      );
    }
    if (value.relation.endOffset !== undefined) {
      relation.endOffset = readNumber(value.relation.endOffset, -MAX_COORDINATE, MAX_COORDINATE);
    }
  }
  return {
    id: readString(value.id, 80),
    kind: readKind(value.kind),
    name: readString(value.name, MAX_NAME_LENGTH),
    x: readNumber(value.x, -MAX_COORDINATE, MAX_COORDINATE),
    y: readNumber(value.y, -MAX_COORDINATE, MAX_COORDINATE),
    width: readNumber(value.width, -MAX_COORDINATE, MAX_COORDINATE),
    height: readNumber(value.height, -MAX_COORDINATE, MAX_COORDINATE),
    cornerRadius: optionalNumber(value.cornerRadius, 0, 0, MAX_CORNER_RADIUS),
    pointRadius: optionalNumber(value.pointRadius, DEFAULT_POINT_RADIUS, 1, MAX_POINT_RADIUS),
    rotation: readNumber(value.rotation, -MAX_ROTATION, MAX_ROTATION),
    stroke: readColor(value.stroke),
    fill: readColor(value.fill),
    strokeWidth: readNumber(value.strokeWidth, 0, MAX_STROKE_WIDTH),
    opacity: readNumber(value.opacity, 0, 1),
    dash: readBoolean(value.dash),
    text: readString(value.text, MAX_TEXT_LENGTH),
    fontSize: readNumber(value.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    fontFamily: fontFamily,
    textAlign: textAlign,
    textDirection: readTextDirection(value.textDirection),
    bold: optionalBoolean(value.bold),
    italic: optionalBoolean(value.italic),
    underline: optionalBoolean(value.underline),
    points: points,
    sides: optionalNumber(
      value.sides,
      DEFAULT_POLYGON_SIDES,
      MIN_POLYGON_SIDES,
      MAX_POLYGON_POINTS
    ),
    bend: optionalNumber(value.bend, 0.5, -MAX_BEND_RATIO, MAX_BEND_RATIO),
    locked: readBoolean(value.locked),
    hidden: readBoolean(value.hidden),
    auxiliary: readBoolean(value.auxiliary),
    group: readString(value.group, 80),
    layer: readNumber(value.layer, -100000, 100000),
    path: path,
    relation: relation
  };
}

/** 旧作品未保存开关时使用关闭状态 */
function optionalBoolean(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  return readBoolean(value);
}

/** 旧作品缺少新增数值时使用默认值 */
function optionalNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) {
    return fallback;
  }
  return readNumber(value, minimum, maximum);
}

/** 旧项目没有文字方向字段时按横排读取，保证已有作品仍可打开 */
function readTextDirection(value: unknown): "horizontal" | "vertical" {
  if (value === undefined || value === "horizontal") {
    return "horizontal";
  }
  if (value === "vertical") {
    return "vertical";
  }
  throw new Error("文字方向无效");
}

/** 验证构造依赖的数量、来源类型和顺序，禁止循环或悬空引用 */
function validateRelations(shapes: Shape[]): void {
  const seen = new Map<string, Shape>();
  for (const shape of shapes) {
    if (shape.id.length === 0 || seen.has(shape.id)) {
      throw new Error("文件包含空编号或重复的对象编号");
    }
    const relation = shape.relation;
    let required = 2;
    if (relation.kind === "none") {
      required = 0;
    }
    if (relation.kind === "midpoint" || relation.kind === "label") {
      required = 1;
    }
    if (relation.sources.length !== required) {
      throw new Error("构造来源数量与构造类型不匹配");
    }
    for (const id of relation.sources) {
      if (!seen.has(id)) {
        throw new Error("构造来源缺失、顺序错误或存在循环关系");
      }
    }
    if (relation.kind !== "none") {
      const first = seen.get(relation.sources[0]);
      const second = seen.get(relation.sources[1]);
      if (first === undefined) {
        throw new Error("缺少构造来源");
      }
      if (relation.kind === "label" && (first.kind !== "point" || shape.kind !== "text")) {
        throw new Error("顶点文字需要关联一个点");
      }
      if (
        relation.kind === "segment" &&
        (first.kind !== "point" ||
          second === undefined ||
          second.kind !== "point" ||
          shape.kind !== "line")
      ) {
        throw new Error("两点线段的来源必须是点");
      }
      if (relation.kind === "midpoint" && (first.kind !== "line" || shape.kind !== "point")) {
        throw new Error("中点必须依附在线段上");
      }
      if (
        relation.kind === "intersection" &&
        (first.kind !== "line" ||
          second === undefined ||
          second.kind !== "line" ||
          shape.kind !== "point")
      ) {
        throw new Error("交点的来源必须是两条直线");
      }
      if (
        (relation.kind === "parallel" || relation.kind === "perpendicular") &&
        (first.kind !== "line" ||
          second === undefined ||
          second.kind !== "point" ||
          shape.kind !== "line")
      ) {
        throw new Error("平行线或垂线需要一条线段和一个点");
      }
      if (
        relation.kind === "connector" &&
        (shape.kind !== "connector" || !isNode(first) || second === undefined || !isNode(second))
      ) {
        throw new Error("连接线的来源必须是两个图形节点");
      }
      if (shape.rotation !== 0) {
        throw new Error("构造对象不能单独旋转");
      }
    }
    seen.set(shape.id, shape);
  }
}

/** 返回对象是否能作为流程图连接节点 */
export function isNode(shape: Shape): boolean {
  return shape.kind === "rect" || shape.kind === "ellipse" || shape.kind === "diamond";
}

/** 读取项目文件或本工具导出的 SVG 元数据，返回验证后的作品 */
export function parseDocument(text: string): BoardDocument {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    throw new Error("文件超过 8 MB，请打开更小的作品");
  }
  const value: unknown = JSON.parse(text);
  if (
    !isRecord(value) ||
    value.format !== "svg-board" ||
    value.version !== 1 ||
    !Array.isArray(value.shapes)
  ) {
    throw new Error("不是受支持的 SVG-Board 项目文件");
  }
  if (value.shapes.length > MAX_SHAPES) {
    throw new Error("对象数量超过上限");
  }
  const shapes: Shape[] = [];
  for (const shape of value.shapes) {
    shapes.push(readShape(shape));
  }
  validateRelations(shapes);
  const document: BoardDocument = {
    format: "svg-board",
    version: 1,
    name: readString(value.name, MAX_NAME_LENGTH),
    width: readNumber(value.width, MIN_BOARD_SIZE, MAX_BOARD_SIZE),
    height: readNumber(value.height, MIN_BOARD_SIZE, MAX_BOARD_SIZE),
    shapes: shapes,
    description: createDocument().description,
    background: DEFAULT_BACKGROUND
  };
  if (value.background !== undefined) {
    const background = readColor(value.background);
    if (background === "none") {
      throw new Error("请选择画布颜色");
    }
    document.background = background;
  }
  if (value.description !== undefined) {
    document.description = readString(value.description, MAX_DESCRIPTION_LENGTH);
  }
  if (isRecord(value.contentBounds)) {
    document.contentBounds = {
      x: readNumber(value.contentBounds.x, -MAX_COORDINATE, MAX_COORDINATE),
      y: readNumber(value.contentBounds.y, -MAX_COORDINATE, MAX_COORDINATE),
      width: readNumber(value.contentBounds.width, 1, MAX_COORDINATE * 2),
      height: readNumber(value.contentBounds.height, 1, MAX_COORDINATE * 2)
    };
  }
  convertPointLabels(document);
  return document;
}
