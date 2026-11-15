import { Circle, Ellipse, Line, Path, Polygon, Rect, Textbox } from "fabric";
import type { FabricObject } from "fabric";
import { getBounds } from "./model";
import type { Shape } from "./types";

/** 根据作品创建库中的几何对象，控制点与变换交给 Fabric */
export function createFabricShape(shape: Shape): FabricObject {
  const bounds = getBounds(shape);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  let object: FabricObject = new Rect({ width: width, height: height, rx: 6, ry: 6 });
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
    object = new Circle({ radius: 5 });
  } else if (shape.kind === "line") {
    object = new Line([0, 0, shape.width, shape.height]);
  } else if (shape.kind === "arrow" || shape.kind === "connector") {
    object = createArrow(shape);
  } else if (shape.kind === "pencil") {
    object = new Path(shape.path, { fill: "" });
    if (object.width > 0 && object.height > 0) {
      object.set({ scaleX: width / object.width, scaleY: height / object.height });
    }
  } else if (shape.kind === "text") {
    object = new Textbox(shape.text, {
      width: width,
      fontSize: shape.fontSize,
      fontFamily: shape.fontFamily,
      textAlign: getTextAlign(shape.textAlign),
      fill: shape.stroke,
      splitByGrapheme: true,
      padding: 4
    });
  }
  let fill = shape.fill;
  if (
    fill === "none" ||
    shape.kind === "line" ||
    shape.kind === "arrow" ||
    shape.kind === "connector" ||
    shape.kind === "pencil"
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
    cornerSize: 10,
    cornerColor: "#ffffff",
    cornerStrokeColor: "#2563eb",
    borderColor: "#2563eb",
    transparentCorners: false,
    padding: 4,
    objectCaching: false,
    lockScalingFlip: true
  });
  // 细线只响应实际笔画，避免点在线条外接矩形的空白处也被选中
  object.perPixelTargetFind = isStrokeShape(shape);
  return object;
}

/** 判断对象是否只有笔画，用于设置精确命中 */
function isStrokeShape(shape: Shape): boolean {
  return (
    shape.kind === "line" ||
    shape.kind === "arrow" ||
    shape.kind === "connector" ||
    shape.kind === "pencil" ||
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
    path = "M " + startX + " " + startY + " H 0 V " + endY + " H " + endX;
    angle = 0;
    if (shape.width < 0) {
      angle = Math.PI;
    }
  }
  const headSize = 10;
  const firstX = endX - headSize * Math.cos(angle - Math.PI / 6);
  const firstY = endY - headSize * Math.sin(angle - Math.PI / 6);
  const secondX = endX - headSize * Math.cos(angle + Math.PI / 6);
  const secondY = endY - headSize * Math.sin(angle + Math.PI / 6);
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

/** 创建不参与命中的标签，标签位置始终由所属对象决定 */
export function createFabricLabel(shape: Shape): Textbox | null {
  if (shape.text === "" || shape.kind === "text") {
    return null;
  }
  const bounds = getBounds(shape);
  let left = bounds.x + bounds.width / 2;
  let top = bounds.y + bounds.height / 2;
  let width = Math.max(100, bounds.width - 16);
  if (shape.kind === "point") {
    left = shape.x + 20;
    top = shape.y - 18;
    width = 80;
  }
  if (shape.kind === "line" || shape.kind === "arrow" || shape.kind === "connector") {
    top = top - 16;
  }
  return new Textbox(shape.text, {
    left: left,
    top: top,
    width: width,
    originX: "center",
    originY: "center",
    fontFamily: shape.fontFamily,
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
