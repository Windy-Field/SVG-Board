import { Path, Point as FabricPoint, util } from "fabric";
import { getBounds, isLine } from "../core/model";
import { getLinePoints } from "./geometry";
import { createFabricShape } from "../canvas/fabric-shapes";
import { regularPoints } from "../objects/shapes";
import type { Point, Shape } from "../core/types";

// 椭圆边框采样点数，影响吸附精度
const ELLIPSE_STEPS = 96;
// 曲线路径采样间距，单位为画布坐标
const CURVE_STEP = 6;
// 单条曲线的采样数上限
const MAX_CURVE_STEPS = 256;
// 每个矩形圆角的采样段数
const CORNER_STEPS = 12;

/** 给圆角矩形的四个角依次取点，直边由相邻角的端点连接 */
function roundedRectangle(width: number, height: number, radius: number): Point[] {
  const centers = [
    { x: width - radius, y: radius },
    { x: width - radius, y: height - radius },
    { x: radius, y: height - radius },
    { x: radius, y: radius }
  ];
  const points: Point[] = [];
  for (let corner = 0; corner < centers.length; corner = corner + 1) {
    for (let step = 0; step <= CORNER_STEPS; step = step + 1) {
      const angle = ((corner - 1) * Math.PI) / 2 + (step * Math.PI) / (CORNER_STEPS * 2);
      points.push({
        x: centers[corner].x + radius * Math.cos(angle),
        y: centers[corner].y + radius * Math.sin(angle)
      });
    }
  }
  return points;
}

/** 将保存的多边形顶点缩放到当前尺寸 */
function polygonPoints(shape: Shape, width: number, height: number): Point[] {
  if (shape.points.length < 3) {
    return regularPoints(width, height, shape.sides);
  }
  let maximumX = 1;
  let maximumY = 1;
  for (const point of shape.points) {
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const points: Point[] = [];
  for (const point of shape.points) {
    points.push({ x: (point.x * width) / maximumX, y: (point.y * height) / maximumY });
  }
  return points;
}

/** 将局部顶点旋转到画布坐标，边框与显示共用对象中心 */
function rotatePoints(shape: Shape, points: Point[]): Point[] {
  const bounds = getBounds(shape);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const angle = (shape.rotation * Math.PI) / 180;
  const result: Point[] = [];
  for (const point of points) {
    const offsetX = point.x - bounds.width / 2;
    const offsetY = point.y - bounds.height / 2;
    result.push({
      x: centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle),
      y: centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
    });
  }
  return result;
}

/** 用库的路径长度与取点接口采样曲线，吸附沿可见笔画进行 */
function pathPoints(shape: Shape): Point[] {
  const object = createFabricShape(shape);
  const points: Point[] = [];
  if (object instanceof Path) {
    const info = util.getPathSegmentsInfo(object.path);
    const total = info[info.length - 1];
    if (total !== undefined) {
      const count = Math.max(8, Math.min(MAX_CURVE_STEPS, Math.ceil(total.length / CURVE_STEP)));
      const matrix = object.calcTransformMatrix();
      for (let index = 0; index <= count; index = index + 1) {
        const point = util.getPointOnPath(object.path, (total.length * index) / count, info);
        if (point !== undefined) {
          const local = new FabricPoint(
            point.x - object.pathOffset.x,
            point.y - object.pathOffset.y
          );
          const scene = local.transform(matrix);
          points.push({ x: scene.x, y: scene.y });
        }
      }
    }
  }
  object.dispose();
  return points;
}

/** 返回按笔画顺序排列的边界点，封闭图形的末点与首点相同 */
export function outlinePoints(shape: Shape): Point[] {
  if (shape.kind === "curve" || shape.kind === "pencil") {
    return pathPoints(shape);
  }
  if (isLine(shape)) {
    if (shape.kind !== "connector") {
      return getLinePoints(shape);
    }
    const bend = shape.width * shape.bend;
    const local = [
      { x: 0, y: 0 },
      { x: bend, y: 0 },
      { x: bend, y: shape.height },
      { x: shape.width, y: shape.height }
    ];
    const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    const angle = (shape.rotation * Math.PI) / 180;
    const points: Point[] = [];
    for (const point of local) {
      const horizontal = point.x - shape.width / 2;
      const vertical = point.y - shape.height / 2;
      points.push({
        x: center.x + horizontal * Math.cos(angle) - vertical * Math.sin(angle),
        y: center.y + horizontal * Math.sin(angle) + vertical * Math.cos(angle)
      });
    }
    return points;
  }
  const bounds = getBounds(shape);
  const width = bounds.width;
  const height = bounds.height;
  let points: Point[] = [];
  if (shape.kind === "ellipse") {
    for (let index = 0; index < ELLIPSE_STEPS; index = index + 1) {
      const angle = (index * Math.PI * 2) / ELLIPSE_STEPS;
      points.push({
        x: width / 2 + (width / 2) * Math.cos(angle),
        y: height / 2 + (height / 2) * Math.sin(angle)
      });
    }
  } else if (shape.kind === "diamond") {
    points = [
      { x: width / 2, y: 0 },
      { x: width, y: height / 2 },
      { x: width / 2, y: height },
      { x: 0, y: height / 2 }
    ];
  } else if (shape.kind === "polygon") {
    points = polygonPoints(shape, width, height);
  } else {
    const radius = Math.min(shape.cornerRadius, width / 2, height / 2);
    if (radius > 0 && shape.kind === "rect") {
      points = roundedRectangle(width, height, radius);
    } else {
      points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
      ];
    }
  }
  const result = rotatePoints(shape, points);
  if (result.length > 0) {
    result.push(result[0]);
  }
  return result;
}
