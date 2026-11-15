import type { BoardDocument, Bounds, Point, Shape, ShapeKind } from "./types";

export const BOARD_WIDTH = 1200;
export const BOARD_HEIGHT = 800;
export const GRID_SIZE = 20;
export const MAX_SHAPES = 2000;
export const MAX_PATH_LENGTH = 200000;
export const HISTORY_LIMIT = 80;
export const DEFAULT_STROKE = "#334155";
export const DEFAULT_FILL = "#ffffff";
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "矩形",
  ellipse: "椭圆",
  diamond: "判断框",
  line: "线段",
  arrow: "箭头",
  pencil: "画笔",
  text: "文字",
  point: "点",
  connector: "连接线",
  polygon: "多边形",
  curve: "贝塞尔曲线"
};

/** 新建空白作品，返回可保存为项目文件的完整结构 */
export function createDocument(): BoardDocument {
  return {
    format: "svg-board",
    version: 1,
    name: "未命名画板",
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    shapes: [],
    description: "# 项目介绍\n\n## 用途\n\n\n## 图示说明\n\n\n## 备注\n\n"
  };
}

/** 按类型与起点创建对象，样式使用统一默认值 */
export function createShape(kind: ShapeKind, position: Point): Shape {
  return {
    id: crypto.randomUUID(),
    kind: kind,
    name: SHAPE_LABELS[kind],
    x: position.x,
    y: position.y,
    width: 0,
    height: 0,
    cornerRadius: 0,
    pointRadius: 5,
    rotation: 0,
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    strokeWidth: 2,
    opacity: 1,
    dash: false,
    text: "",
    fontSize: 20,
    fontFamily: "sans-serif",
    textAlign: "middle",
    textDirection: "horizontal",
    bold: false,
    italic: false,
    underline: false,
    points: [],
    sides: 5,
    bend: 0.5,
    locked: false,
    hidden: false,
    auxiliary: false,
    group: "",
    layer: 0,
    path: "",
    relation: { kind: "none", sources: [] }
  };
}

/** 通过编号查找对象，不存在时返回 undefined */
export function findShape(document: BoardDocument, id: string): Shape | undefined {
  for (const shape of document.shapes) {
    if (shape.id === id) {
      return shape;
    }
  }
  return undefined;
}

/** 按对象层级排序，供画布、图层面板与导出共用 */
export function compareLayers(first: Shape, second: Shape): number {
  return first.layer - second.layer;
}

/** 判断对象是否用起点与终点表示，方便共用移动和选框逻辑 */
export function isLine(shape: Shape): boolean {
  return shape.kind === "line" || shape.kind === "arrow" || shape.kind === "connector";
}

/** 判断对象是否由其他对象计算得到，避免直接拖动破坏构造关系 */
export function isDependent(shape: Shape): boolean {
  return shape.relation.kind !== "none";
}

/** 计算未旋转对象的边界，线段宽高可以为负 */
export function getBounds(shape: Shape): Bounds {
  let width = shape.width;
  let height = shape.height;
  let left = shape.x;
  let top = shape.y;
  if (shape.kind === "point") {
    const radius = shape.pointRadius + shape.strokeWidth / 2;
    return { x: left - radius, y: top - radius, width: radius * 2, height: radius * 2 };
  }
  if (width < 0) {
    left = left + width;
    width = -width;
  }
  if (height < 0) {
    top = top + height;
    height = -height;
  }
  return { x: left, y: top, width: width, height: height };
}

/** 计算包含旋转效果的边界，供多选、框选和裁剪导出使用 */
export function getRotatedBounds(shape: Shape): Bounds {
  const bounds = getBounds(shape);
  const radians = (shape.rotation * Math.PI) / 180;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  const rotatedWidth =
    Math.abs(halfWidth * Math.cos(radians)) + Math.abs(halfHeight * Math.sin(radians));
  const rotatedHeight =
    Math.abs(halfWidth * Math.sin(radians)) + Math.abs(halfHeight * Math.cos(radians));
  return {
    x: centerX - rotatedWidth,
    y: centerY - rotatedHeight,
    width: rotatedWidth * 2,
    height: rotatedHeight * 2
  };
}

/** 合并多个对象的边界，空数组返回 null */
export function getCombinedBounds(shapes: Shape[]): Bounds | null {
  if (shapes.length === 0) {
    return null;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const shape of shapes) {
    const bounds = getRotatedBounds(shape);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 将对象移动指定距离，画笔路径由渲染库跟随对象的位置显示 */
export function moveShape(shape: Shape, offsetX: number, offsetY: number): void {
  shape.x = shape.x + offsetX;
  shape.y = shape.y + offsetY;
}

/** 调整模型中的尺寸，具体缩放计算交给渲染库 */
export function resizeShape(shape: Shape, width: number, height: number): void {
  shape.width = width;
  shape.height = height;
}

/** 用作品快照维护撤销和重做，每次完整操作只记录一次 */
export class History {
  private snapshots: string[] = [];
  private index = -1;

  /** 切换存档时清空历史，防止撤销回到另一份作品 */
  reset(document: BoardDocument): void {
    this.snapshots = [];
    this.index = -1;
    this.push(document);
  }

  /** 写入当前作品，丢弃撤销后产生的旧分支，返回是否新增记录 */
  push(document: BoardDocument): boolean {
    const snapshot = JSON.stringify(document);
    if (this.snapshots[this.index] === snapshot) {
      return false;
    }
    this.snapshots = this.snapshots.slice(0, this.index + 1);
    this.snapshots.push(snapshot);
    if (this.snapshots.length > HISTORY_LIMIT) {
      this.snapshots.shift();
    }
    this.index = this.snapshots.length - 1;
    return true;
  }

  /** 撤销到上一份快照，没有可撤销内容时返回 null */
  undo(): string | null {
    if (!this.canUndo()) {
      return null;
    }
    this.index = this.index - 1;
    return this.snapshots[this.index];
  }

  /** 恢复下一份快照，没有可恢复内容时返回 null */
  redo(): string | null {
    if (!this.canRedo()) {
      return null;
    }
    this.index = this.index + 1;
    return this.snapshots[this.index];
  }

  /** 返回当前是否存在更早的作品快照 */
  canUndo(): boolean {
    return this.index > 0;
  }

  /** 返回当前是否存在撤销后尚未恢复的作品快照 */
  canRedo(): boolean {
    return this.index < this.snapshots.length - 1;
  }
}
