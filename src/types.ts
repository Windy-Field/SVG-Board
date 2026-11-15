export type ShapeKind =
  | "rect"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "pencil"
  | "text"
  | "point"
  | "connector"
  | "polygon"
  | "curve";
export type Tool = ShapeKind | "select" | "hand" | "vertical-text" | "square" | "custom-polygon";
export type RelationKind =
  | "none"
  | "connector"
  | "segment"
  | "midpoint"
  | "intersection"
  | "parallel"
  | "perpendicular"
  | "label";

/** 保存画布坐标，不包含浏览器窗口或缩放后的屏幕坐标 */
export interface Point {
  x: number;
  y: number;
}

/** 记录构造方式和来源对象，来源编号的顺序由具体构造决定 */
export interface Relation {
  kind: RelationKind;
  sources: string[];
  offsetX?: number;
  offsetY?: number;
}

/** 保存一个可编辑对象，线段使用起点位置与带正负号的宽高表示方向 */
export interface Shape {
  id: string;
  kind: ShapeKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  dash: boolean;
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: string;
  textDirection: "horizontal" | "vertical";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  points: Point[];
  sides: number;
  bend: number;
  locked: boolean;
  hidden: boolean;
  auxiliary: boolean;
  group: string;
  layer: number;
  path: string;
  relation: Relation;
}

/** 项目文件只保存作品内容，选择状态和撤销记录不写入文件 */
export interface BoardDocument {
  format: "svg-board";
  version: 1;
  name: string;
  width: number;
  height: number;
  shapes: Shape[];
  description: string;
  contentBounds?: Bounds;
}

/** 记录画布视口，平移和缩放不改变作品中的对象坐标 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** 用统一矩形表示选择范围、框选范围和导出范围 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
