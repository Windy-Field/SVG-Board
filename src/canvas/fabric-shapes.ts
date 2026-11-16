import { Circle, Ellipse, Line, Path, Polygon, Rect, Textbox } from "fabric";
import type { FabricObject } from "fabric";
import { getBounds } from "../core/model";
import type { Shape } from "../core/types";
import { curvePath, regularPoints } from "../objects/shapes";

// 控制点大小，单位为屏幕像素
export const HANDLE_SIZE = 10;
// 选区与文字外侧的交互留白
const OBJECT_PADDING = 4;
// 选区边框和控制点描边颜色
export const SELECTION_COLOR = "#2563eb";
// 箭头两翼的最小长度
const ARROW_HEAD_SIZE = 20;
// 箭头两翼长度相对线宽的倍率
const ARROW_HEAD_STROKE_RATIO = 5;
// 箭头两翼与线身的夹角，单位为弧度
const ARROW_HEAD_ANGLE = Math.PI / 6;
// 图形标签文本框的最小宽度
const LABEL_MIN_WIDTH = 100;
// 图形标签左右预留的总宽度
const LABEL_HORIZONTAL_PADDING = 16;
// 线条标签向上偏移的距离
const LINE_LABEL_OFFSET = 16;

/** 根据作品创建库中的几何对象，控制点与变换交给 Fabric */
export function createFabricShape(shape: Shape): FabricObject {
  const bounds = getBounds(shape);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const radius = Math.min(shape.cornerRadius, width / 2, height / 2);
  let object: FabricObject = new Rect({ width: width, height: height, rx: radius, ry: radius });
  if (shape.kind === "ellipse") {
    object = new Ellipse({ rx: width / 2, ry: height / 2 });
  } else if (shape.kind === "diamond") {
    object = new Polygon([
      { x: width / 2, y: 0 },
      { x: width, y: height / 2 },
      { x: width / 2, y: height },
      { x: 0, y: height / 2 }
    ]);
  } else if (shape.kind === "point") {
    object = new Circle({ radius: shape.pointRadius });
  } else if (shape.kind === "line") {
    object = new Line([0, 0, shape.width, shape.height]);
  } else if (shape.kind === "arrow" || shape.kind === "connector") {
    object = createArrow(shape);
  } else if (shape.kind === "pencil") {
    object = new Path(shape.path, { fill: "" });
    if (object.width > 0 && object.height > 0) {
      object.set({ scaleX: width / object.width, scaleY: height / object.height });
    }
  } else if (shape.kind === "polygon") {
    let points = shape.points;
    if (points.length < 3) {
      points = regularPoints(width, height, shape.sides);
    }
    object = new Polygon(points);
    if (object.width > 0 && object.height > 0) {
      object.set({ scaleX: width / object.width, scaleY: height / object.height });
    }
  } else if (shape.kind === "curve") {
    let path = shape.path;
    if (path === "") {
      path = curvePath(shape);
    }
    object = new Path(path, { fill: "" });
    if (shape.path !== "" && object.width > 0 && object.height > 0) {
      object.set({ scaleX: width / object.width, scaleY: height / object.height });
    }
  } else if (shape.kind === "text") {
    let displayText = shape.text;
    if (shape.textDirection === "vertical") {
      const characters = Array.from(shape.text);
      displayText = characters.join("\n");
    }
    object = new Textbox(displayText, {
      width: width,
      fontSize: shape.fontSize,
      fontFamily: shape.fontFamily,
      fontWeight: getFontWeight(shape),
      fontStyle: getFontStyle(shape),
      underline: shape.underline,
      textAlign: getTextAlign(shape.textAlign),
      fill: shape.stroke,
      splitByGrapheme: true,
      padding: OBJECT_PADDING
    });
    object.set({ minWidth: 12 });
    // 使用字体的自然高度，不把一行标题强行拉伸成预设文本框高度
  }
  let fill = shape.fill;
  if (
    fill === "none" ||
    shape.kind === "line" ||
    shape.kind === "arrow" ||
    shape.kind === "connector" ||
    shape.kind === "pencil" ||
    shape.kind === "curve"
  ) {
    fill = "";
  }
  let stroke = shape.stroke;
  let strokeWidth = shape.strokeWidth;
  if (shape.kind === "text") {
    fill = shape.stroke;
    stroke = "";
    strokeWidth = 0;
  }
  let dash: number[] | null = null;
  if (shape.dash) {
    dash = [8, 6];
  }
  object.set({
    left: bounds.x + bounds.width / 2,
    top: bounds.y + bounds.height / 2,
    originX: "center",
    originY: "center",
    angle: shape.rotation,
    stroke: stroke,
    fill: fill,
    strokeWidth: strokeWidth,
    strokeDashArray: dash,
    opacity: shape.opacity,
    strokeUniform: true,
    cornerStyle: "circle",
    cornerSize: HANDLE_SIZE,
    cornerColor: "#ffffff",
    cornerStrokeColor: SELECTION_COLOR,
    borderColor: SELECTION_COLOR,
    transparentCorners: false,
    padding: OBJECT_PADDING,
    objectCaching: false,
    lockScalingFlip: true
  });
  object.set({ strokeLineCap: "round", strokeLineJoin: "round" });
  if (shape.kind === "arrow" || shape.kind === "connector") {
    object.set({ strokeLineJoin: "miter" });
  }
  if (object instanceof Path && (shape.kind === "arrow" || shape.kind === "connector")) {
    // 路径外框包含箭头两翼，不能把外框中心误当成线段中心
    const angle = (shape.rotation * Math.PI) / 180;
    object.left =
      object.left + object.pathOffset.x * Math.cos(angle) - object.pathOffset.y * Math.sin(angle);
    object.top =
      object.top + object.pathOffset.x * Math.sin(angle) + object.pathOffset.y * Math.cos(angle);
  }
  if (shape.kind === "text") {
    object.top = bounds.y + object.getScaledHeight() / 2;
  }
  // 细线只响应实际笔画，避免点在线条外接矩形的空白处也被选中
  object.perPixelTargetFind = isStrokeShape(shape);
  // 字体初始化可能缓存旧边界，位置设置完成后再计算命中与导出范围
  object.setCoords();
  return object;
}

/** 判断对象是否只有笔画，用于设置精确命中 */
function isStrokeShape(shape: Shape): boolean {
  if (shape.kind === "text") {
    return false;
  }
  return (
    shape.kind === "line" ||
    shape.kind === "arrow" ||
    shape.kind === "connector" ||
    shape.kind === "pencil" ||
    shape.kind === "curve" ||
    shape.fill === "none"
  );
}

/** 在原对象上更新关联几何，不从画布移除对象，以保留选区与图层顺序 */
export function updateFabricGeometry(object: FabricObject, shape: Shape): void {
  const replacement = createFabricShape(shape);
  if (object instanceof Path && replacement instanceof Path) {
    object.set({ path: replacement.path, pathOffset: replacement.pathOffset });
  }
  if (object instanceof Line && replacement instanceof Line) {
    object.set({ x1: replacement.x1, y1: replacement.y1, x2: replacement.x2, y2: replacement.y2 });
  }
  object.set({
    width: replacement.width,
    height: replacement.height,
    scaleX: replacement.scaleX,
    scaleY: replacement.scaleY,
    angle: shape.rotation
  });
  object.setXY(replacement.getCenterPoint(), "center", "center");
  object.setCoords();
  replacement.dispose();
}

/** 生成箭头或直角连接线的路径，箭头与线始终作为一个对象编辑 */
function createArrow(shape: Shape): Path {
  const startX = -shape.width / 2;
  const startY = -shape.height / 2;
  const endX = shape.width / 2;
  const endY = shape.height / 2;
  let path = "M " + startX + " " + startY + " L " + endX + " " + endY;
  let angle = Math.atan2(shape.height, shape.width);
  if (shape.kind === "connector") {
    const bendX = startX + shape.width * shape.bend;
    path = "M " + startX + " " + startY + " H " + bendX + " V " + endY + " H " + endX;
    angle = 0;
    if (shape.width < 0) {
      angle = Math.PI;
    }
  }
  if (shape.kind === "connector" && Math.abs(shape.width) < 1) {
    angle = Math.PI / 2;
    if (shape.height < 0) {
      angle = -Math.PI / 2;
    }
  }
  const headSize = Math.max(ARROW_HEAD_SIZE, shape.strokeWidth * ARROW_HEAD_STROKE_RATIO);
  const firstX = endX - headSize * Math.cos(angle - ARROW_HEAD_ANGLE);
  const firstY = endY - headSize * Math.sin(angle - ARROW_HEAD_ANGLE);
  const secondX = endX - headSize * Math.cos(angle + ARROW_HEAD_ANGLE);
  const secondY = endY - headSize * Math.sin(angle + ARROW_HEAD_ANGLE);
  path =
    path +
    " M " +
    firstX +
    " " +
    firstY +
    " L " +
    endX +
    " " +
    endY +
    " L " +
    secondX +
    " " +
    secondY;
  return new Path(path, { fill: "" });
}

/** 将项目的文本锚点转换为库支持的对齐名称 */
function getTextAlign(anchor: string): "left" | "center" | "right" {
  if (anchor === "start") {
    return "left";
  }
  if (anchor === "end") {
    return "right";
  }
  return "center";
}

/** 按图形位置创建标签，选中后可转为独立文本框 */
export function createFabricLabel(shape: Shape): Textbox | null {
  if (shape.text === "" || shape.kind === "text") {
    return null;
  }
  const bounds = getBounds(shape);
  let left = bounds.x + bounds.width / 2;
  let top = bounds.y + bounds.height / 2;
  let width = Math.max(LABEL_MIN_WIDTH, bounds.width - LABEL_HORIZONTAL_PADDING);
  if (shape.kind === "point") {
    left = shape.x + 20;
    top = shape.y - 18;
    width = 80;
  }
  if (shape.kind === "line" || shape.kind === "arrow" || shape.kind === "connector") {
    top = top - LINE_LABEL_OFFSET;
  }
  return new Textbox(shape.text, {
    left: left,
    top: top,
    width: width,
    originX: "center",
    originY: "center",
    fontFamily: shape.fontFamily,
    fontWeight: getFontWeight(shape),
    fontStyle: getFontStyle(shape),
    underline: shape.underline,
    fontSize: shape.fontSize,
    textAlign: getTextAlign(shape.textAlign),
    fill: shape.stroke,
    angle: shape.rotation,
    opacity: shape.opacity,
    selectable: false,
    evented: false,
    splitByGrapheme: true
  });
}

/** 将加粗开关转换为字体字重 */
function getFontWeight(shape: Shape): number {
  if (shape.bold) {
    return 700;
  }
  return 400;
}

/** 返回文本的斜体设置 */
function getFontStyle(shape: Shape): "italic" | "normal" {
  if (shape.italic) {
    return "italic";
  }
  return "normal";
}
