import type { BoardDocument, Bounds, Point, Shape, ShapeKind } from "./types";

// 新建画板的默认宽度，单位为画布坐标
export const BOARD_WIDTH = 1200;
// 新建画板的默认高度，单位为画布坐标
export const BOARD_HEIGHT = 800;
// 网格间距，绘制和端点调整共用
export const GRID_SIZE = 20;
// 单份作品的对象数量上限
export const MAX_SHAPES = 2000;
// 单条路径允许保存的最大字符数
export const MAX_PATH_LENGTH = 200000;
// 坐标和对象尺寸允许的最大绝对值
export const MAX_COORDINATE = 100000;
// 保存画板允许的最小边长
export const MIN_BOARD_SIZE = 100;
// 保存画板允许的最大边长
export const MAX_BOARD_SIZE = 10000;
// 撤销历史保留的最大快照数
export const HISTORY_LIMIT = 80;
// 新对象的默认描边颜色
export const DEFAULT_STROKE = "#334155";
// 新对象的默认填充颜色
export const DEFAULT_FILL = "#ffffff";
// 新作品的默认画布底色
export const DEFAULT_BACKGROUND = "#ffffff";
// 文字大小下限，单位为画布坐标
export const MIN_FONT_SIZE = 8;
// 文字大小上限，单位为画布坐标
export const MAX_FONT_SIZE = 200;
// 新对象默认字号
export const DEFAULT_FONT_SIZE = 20;
// 几何点默认半径
export const DEFAULT_POINT_RADIUS = 5;
// 正多边形默认边数
export const DEFAULT_POLYGON_SIDES = 5;
// 普通对象的默认描边宽度
export const DEFAULT_STROKE_WIDTH = 2;
// 几何点允许的最大半径
export const MAX_POINT_RADIUS = 5000;
// 矩形允许的最大圆角半径
export const MAX_CORNER_RADIUS = 50000;
// 多边形设置框允许的最少边数
export const MIN_POLYGON_SIDES = 3;
// 正多边形工具允许的最多边数
export const MAX_REGULAR_SIDES = 32;
// 自定义多边形允许的最多顶点数
export const MAX_POLYGON_POINTS = 1000;
// 折线中段允许超出两端范围的最大比例
export const MAX_BEND_RATIO = 10;
// 作品名称与对象名称的最大字符数
export const MAX_NAME_LENGTH = 100;
// 单个文字对象的最大字符数
export const MAX_TEXT_LENGTH = 10000;
// Markdown 项目说明的最大字符数
export const MAX_DESCRIPTION_LENGTH = 100000;
// 对象允许的最大旋转角度绝对值，单位为度
export const MAX_ROTATION = 36000;
// 对象描边的最大宽度，单位为画布坐标
export const MAX_STROKE_WIDTH = 100;
// 新作品的说明初始模板
const DESCRIPTION_TEMPLATE = "# 项目介绍\n\n## 用途\n\n\n## 图示说明\n\n\n## 备注\n\n";
// 图形名称用于属性标题与新对象命名
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
  curve: "贝塞尔曲线",
  function: "函数"
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
    background: DEFAULT_BACKGROUND,
    description: DESCRIPTION_TEMPLATE
  };
}

/** 按类型与起点创建对象，样式使用统一默认值 */
export function createShape(kind: ShapeKind, position: Point): Shape {
  return {
    id: crypto.randomUUID(),
    kind: kind,
    lineType: "segment",
    coordinatePoint: false,
    name: SHAPE_LABELS[kind],
    x: position.x,
    y: position.y,
    width: 0,
    height: 0,
    cornerRadius: 0,
    pointRadius: DEFAULT_POINT_RADIUS,
    rotation: 0,
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    opacity: 1,
    dash: false,
    text: "",
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: "sans-serif",
    textAlign: "middle",
    textDirection: "horizontal",
    bold: false,
    italic: false,
    underline: false,
    points: [],
    sides: DEFAULT_POLYGON_SIDES,
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

/** 按对象层级排序，供画布、对象管理与导出共用 */
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
