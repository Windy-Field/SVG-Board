import { Path, Point as FabricPoint, util } from "fabric";
import Flatten from "@flatten-js/core";
import { getBounds, isLine, MAX_POLYGON_POINTS } from "../core/model";
import { createFabricShape } from "../canvas/fabric-shapes";
import { regularPoints } from "../objects/shapes";
import type { Point, Shape } from "../core/types";
import { extendedLinePoints } from "./extended-lines";

// 椭圆边框采样点数，影响吸附精度
const ELLIPSE_STEPS = 96;
// 曲线路径采样间距，单位为画布坐标
const CURVE_STEP = 6;
// 单条曲线的采样数上限
const MAX_CURVE_STEPS = 256;
// 每个矩形圆角的采样段数
const CORNER_STEPS = 12;

/** 记录图形上一条可用于构造的直边，编号随位置、尺寸和旋转保持不变 */
export interface OutlineEdge {
  start: Point;
  end: Point;
}

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
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  for (const point of shape.points) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  // SVG 导入的顶点不一定从零开始，按图形自身的外框换算才能贴合画面
  const spanX = maximumX - minimumX;
  const spanY = maximumY - minimumY;
  if (spanX <= 0 || spanY <= 0) {
    return [];
  }
  const points: Point[] = [];
  for (const point of shape.points) {
    points.push({
      x: ((point.x - minimumX) * width) / spanX,
      y: ((point.y - minimumY) * height) / spanY
    });
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
  if (shape.kind === "function") {
    const commands = util.parsePath(shape.path);
    const points: Point[] = [];
    for (const command of commands) {
      if (command[0] === "M") {
        points.push({ x: NaN, y: NaN });
      }
      if (command[0] === "M" || command[0] === "L") {
        points.push({ x: command[1], y: command[2] });
      }
    }
    return points;
  }
  if (shape.kind === "curve" || shape.kind === "pencil" || shape.kind === "path") {
    return pathPoints(shape);
  }
  if (isLine(shape)) {
    if (shape.kind !== "connector") {
      return extendedLinePoints(shape);
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

/** 用 Fabric 的实际变换提取 SVG 路径的直线段，跳过曲线和子路径之间的空白 */
function straightPathEdges(shape: Shape): OutlineEdge[] {
  const object = createFabricShape(shape);
  const edges: OutlineEdge[] = [];
  if (object instanceof Path) {
    const matrix = object.calcTransformMatrix();
    let first: Point | undefined;
    let previous: Point | undefined;
    for (const command of object.path) {
      const kind = command[0];
      let next = first;
      if (kind !== "Z") {
        const horizontal = command[command.length - 2];
        const vertical = command[command.length - 1];
        if (typeof horizontal !== "number" || typeof vertical !== "number") {
          continue;
        }
        const local = new FabricPoint(
          horizontal - object.pathOffset.x,
          vertical - object.pathOffset.y
        );
        const scene = local.transform(matrix);
        next = { x: scene.x, y: scene.y };
      }
      if (kind === "M") {
        first = next;
      }
      if ((kind === "L" || kind === "Z") && previous !== undefined && next !== undefined) {
        edges.push({ start: previous, end: next });
        if (edges.length > MAX_POLYGON_POINTS) {
          object.dispose();
          return [];
        }
      }
      previous = next;
    }
  }
  object.dispose();
  return edges;
}

/** 取得可用于几何构造的直边，圆角只保留两段圆弧之间的直边 */
export function straightOutlineEdges(shape: Shape): OutlineEdge[] {
  if (shape.kind === "path") {
    return straightPathEdges(shape);
  }
  if (
    shape.kind !== "rect" &&
    shape.kind !== "diamond" &&
    shape.kind !== "polygon" &&
    shape.kind !== "arrow" &&
    shape.kind !== "connector"
  ) {
    return [];
  }
  const points = outlinePoints(shape);
  const edges: OutlineEdge[] = [];
  if (shape.kind === "rect" && points.length > 5) {
    // 从上边开始，圆角大小改变后，上、右、下、左的编号仍然一致
    edges.push({ start: points[points.length - 2], end: points[0] });
    const step = CORNER_STEPS + 1;
    for (let end = step; end < points.length - 1; end = end + step) {
      edges.push({ start: points[end - 1], end: points[end] });
    }
    return edges;
  }
  for (let end = 1; end < points.length; end = end + 1) {
    edges.push({ start: points[end - 1], end: points[end] });
  }
  return edges;
}

/** 返回指定距离内离指针最近的直边编号，忽略没有长度的边 */
export function nearestOutlineEdge(
  edges: OutlineEdge[],
  position: Point,
  maximumDistance: number
): number | undefined {
  const pointer = new Flatten.Point(position.x, position.y);
  let nearest: number | undefined;
  let distance = maximumDistance;
  for (let index = 0; index < edges.length; index = index + 1) {
    const edge = edges[index];
    const start = new Flatten.Point(edge.start.x, edge.start.y);
    const end = new Flatten.Point(edge.end.x, edge.end.y);
    if (start.equalTo(end)) {
      continue;
    }
    const segment = new Flatten.Segment(start, end);
    const result = pointer.distanceTo(segment);
    if (result[0] <= distance) {
      distance = result[0];
      nearest = index;
    }
  }
  return nearest;
}
