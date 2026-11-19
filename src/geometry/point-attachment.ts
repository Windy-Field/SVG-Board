import Flatten from "@flatten-js/core";
import { Path, Point as FabricPoint, util } from "fabric";
import type { TPathSegmentInfo, TSimpleParsedCommand } from "fabric";
import { createFabricShape } from "../canvas/fabric-shapes";
import { findShape, getRotatedBounds, MAX_COORDINATE } from "../core/model";
import type { BoardDocument, Bounds, Point, Shape } from "../core/types";
import { toCanvasPoint, toMathPoint } from "../math/coordinates";
import { hasOpenDomain } from "../math/domain";
import { compileExpression, evaluateExpression } from "../math/expressions";
import { updateFunctionPath } from "../math/plots";
import { getLinePoints } from "./geometry";
import { outlinePoints } from "./outlines";

// 查找可依附轮廓时，指针与轮廓允许相差的屏幕像素数
const ATTACH_DISTANCE = 8;
// 圆周一圈对应的弧度，用于保存椭圆上的相对位置
const FULL_TURN = Math.PI * 2;
// 每段贝塞尔曲线的投影采样数，最终位置再用曲线公式计算
const PATH_CURVE_STEPS = 16;

/** 保存轮廓上的位置及它对应的画布坐标 */
interface OutlinePosition {
  position: Point;
  parameter: number;
}

/** 记录轮廓上的一小段以及它在整个轮廓上的起始距离 */
interface OutlinePart {
  start: Point;
  end: Point;
  offset: number;
  length: number;
}

/** 只有能取得真实轮廓的图形才可作为依附对象 */
export function canAttachPoint(shape: Shape): boolean {
  return shape.kind !== "point" && shape.kind !== "text" && shape.kind !== "svg-image";
}

/** 点的坐标和参数都要能写入存档，避免拖到极远的位置后无法保存 */
function canStoreMatch(match: OutlinePosition): boolean {
  return (
    Math.abs(match.parameter) <= MAX_COORDINATE &&
    Math.abs(match.position.x) <= MAX_COORDINATE &&
    Math.abs(match.position.y) <= MAX_COORDINATE
  );
}

/** 函数和拟合曲线按解析式重新求值，点不会离开曲线或跑出定义域 */
function functionPosition(shape: Shape, horizontal: number): Point | null {
  const formula = shape.formula;
  if (formula === undefined) {
    return null;
  }
  if (typeof formula.minimum === "number" && horizontal < formula.minimum) {
    return null;
  }
  if (typeof formula.maximum === "number" && horizontal > formula.maximum) {
    return null;
  }
  const compiled = compileExpression(formula.expression);
  const vertical = evaluateExpression(compiled, horizontal);
  if (vertical === null) {
    return null;
  }
  return toCanvasPoint({ x: horizontal, y: vertical });
}

/** 转到椭圆的局部坐标，以便计算点在圆周上的角度 */
function ellipseAngle(shape: Shape, position: Point): number {
  const center = ellipseCenter(shape);
  const angle = (shape.rotation * Math.PI) / 180;
  const horizontal = position.x - center.x;
  const vertical = position.y - center.y;
  const localX = horizontal * Math.cos(angle) + vertical * Math.sin(angle);
  const localY = -horizontal * Math.sin(angle) + vertical * Math.cos(angle);
  const radians = Math.atan2(localY / shape.height, localX / shape.width);
  return (radians + FULL_TURN) % FULL_TURN;
}

/** 取得椭圆中心，旋转围绕此点进行 */
function ellipseCenter(shape: Shape): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** 用保存的角度计算圆周上的准确位置，避免落在采样弦内部 */
function ellipsePosition(shape: Shape, parameter: number): Point | null {
  if (shape.width <= 0 || shape.height <= 0) {
    return null;
  }
  const center = ellipseCenter(shape);
  const angle = (shape.rotation * Math.PI) / 180;
  const horizontal = (shape.width / 2) * Math.cos(parameter * FULL_TURN);
  const vertical = (shape.height / 2) * Math.sin(parameter * FULL_TURN);
  return {
    x: center.x + horizontal * Math.cos(angle) - vertical * Math.sin(angle),
    y: center.y + horizontal * Math.sin(angle) + vertical * Math.cos(angle)
  };
}

/** 用端点之间的比例还原坐标，直线与射线可以使用端点之外的比例 */
function between(start: Point, end: Point, ratio: number): Point {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio
  };
}

/** 用投影计算直线上的位置，线段和射线不会越过各自的端点 */
function projectLine(shape: Shape, position: Point): OutlinePosition | null {
  const ends = getLinePoints(shape);
  const start = ends[0];
  const end = ends[1];
  const horizontal = end.x - start.x;
  const vertical = end.y - start.y;
  const squareLength = horizontal * horizontal + vertical * vertical;
  if (squareLength === 0) {
    return null;
  }
  let ratio =
    ((position.x - start.x) * horizontal + (position.y - start.y) * vertical) / squareLength;
  if (shape.lineType !== "straight") {
    ratio = Math.max(0, ratio);
  }
  if (shape.lineType === "segment") {
    ratio = Math.min(1, ratio);
  }
  return { position: between(start, end, ratio), parameter: ratio };
}

/** 将轮廓转成可投影的短线段，分段曲线之间的空白不计入长度 */
function outlineParts(shape: Shape): OutlinePart[] {
  const points = outlinePoints(shape);
  const parts: OutlinePart[] = [];
  let offset = 0;
  for (let index = 1; index < points.length; index = index + 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(length) || length === 0) {
      continue;
    }
    parts.push({ start: start, end: end, offset: offset, length: length });
    offset = offset + length;
  }
  return parts;
}

/** 从轮廓线段中找到距离指针最近的点，并记下沿轮廓走过的比例 */
function projectOutline(shape: Shape, pointer: Point): OutlinePosition | null {
  const parts = outlineParts(shape);
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return null;
  }
  const total = last.offset + last.length;
  const origin = new Flatten.Point(pointer.x, pointer.y);
  let closest: OutlinePosition | null = null;
  let distance = Infinity;
  for (const part of parts) {
    const start = new Flatten.Point(part.start.x, part.start.y);
    const end = new Flatten.Point(part.end.x, part.end.y);
    const segment = new Flatten.Segment(start, end);
    const projection = origin.distanceTo(segment);
    if (projection[0] < distance) {
      const point = projection[1].end;
      const offset = part.offset + Math.hypot(point.x - start.x, point.y - start.y);
      closest = { position: { x: point.x, y: point.y }, parameter: Math.min(1, offset / total) };
      distance = projection[0];
    }
  }
  return closest;
}

/** 计算一条路径命令上的准确位置，并应用该图形的缩放和旋转 */
function pathCommandPoint(
  path: Path,
  command: TSimpleParsedCommand,
  info: TPathSegmentInfo,
  ratio: number
): Point | null {
  let local: Point;
  const start = { x: info.x, y: info.y };
  if ("iterator" in info) {
    local = info.iterator(ratio);
  } else if (command[0] === "L") {
    local = between(start, { x: command[1], y: command[2] }, ratio);
  } else if ("destX" in info) {
    local = between(start, { x: info.destX, y: info.destY }, ratio);
  } else {
    return null;
  }
  const relative = new FabricPoint(local.x - path.pathOffset.x, local.y - path.pathOffset.y);
  const scene = relative.transform(path.calcTransformMatrix());
  return { x: scene.x, y: scene.y };
}

/** 在实际绘制的命令上寻找落点，不连接彼此分离的子路径 */
function projectPath(path: Path, pointer: Point): OutlinePosition | null {
  const infos = util.getPathSegmentsInfo(path.path);
  const origin = new Flatten.Point(pointer.x, pointer.y);
  let closest: OutlinePosition | null = null;
  let nearest = Infinity;
  for (let index = 0; index < path.path.length; index = index + 1) {
    const command = path.path[index];
    const info = infos[index];
    if (command[0] === "M" || info.length <= 0) {
      continue;
    }
    let steps = 1;
    if ("iterator" in info) {
      steps = PATH_CURVE_STEPS;
    }
    let previous = pathCommandPoint(path, command, info, 0);
    for (let step = 1; step <= steps; step = step + 1) {
      const next = pathCommandPoint(path, command, info, step / steps);
      if (previous !== null && next !== null) {
        const start = new Flatten.Point(previous.x, previous.y);
        const end = new Flatten.Point(next.x, next.y);
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length > 0) {
          const segment = new Flatten.Segment(start, end);
          const projection = origin.distanceTo(segment);
          const projected = projection[1].end;
          const fraction = Math.min(
            1,
            Math.hypot(projected.x - start.x, projected.y - start.y) / length
          );
          const ratio = (step - 1 + fraction) / steps;
          const exact = pathCommandPoint(path, command, info, ratio);
          if (exact !== null) {
            const gap = Math.hypot(pointer.x - exact.x, pointer.y - exact.y);
            if (gap < nearest) {
              nearest = gap;
              // 命令编号加上命令内部比例；末端略向内取值，避免被还原成下一条命令
              const commandPosition = index + Math.min(ratio, 1 - Number.EPSILON * (index + 1));
              closest = { position: exact, parameter: commandPosition / path.path.length };
            }
          }
        }
      }
      previous = next;
    }
  }
  return closest;
}

/** 判断是否使用 Fabric 的路径命令定位，而不是使用图形外框 */
function usesPath(shape: Shape): boolean {
  return shape.kind === "curve" || shape.kind === "pencil" || shape.kind === "path";
}

/** 还原路径命令及其内部比例，旋转或缩放后仍取同一段曲线 */
function savedPathPosition(shape: Shape, parameter: number): Point | null {
  const object = createFabricShape(shape);
  let result: Point | null = null;
  if (object instanceof Path && object.path.length > 0) {
    const commandPosition = object.path.length * parameter;
    const index = Math.min(object.path.length - 1, Math.floor(commandPosition));
    const infos = util.getPathSegmentsInfo(object.path);
    const command = object.path[index];
    if (command !== undefined) {
      result = pathCommandPoint(object, command, infos[index], commandPosition - index);
    }
  }
  object.dispose();
  return result;
}

/** 将指针投影到指定来源，已依附的点不参与其他图形的吸附 */
function projectSource(shape: Shape, pointer: Point, view: Bounds): OutlinePosition | null {
  if (shape.kind === "line" || shape.kind === "arrow") {
    return projectLine(shape, pointer);
  }
  if (usesPath(shape)) {
    const object = createFabricShape(shape);
    let position: OutlinePosition | null = null;
    if (object instanceof Path) {
      position = projectPath(object, pointer);
    }
    object.dispose();
    return position;
  }
  let outline = shape;
  if (hasOpenDomain(shape.formula)) {
    outline = Object.assign({}, shape);
    updateFunctionPath(outline, view);
  }
  const closest = projectOutline(outline, pointer);
  if (closest === null) {
    return null;
  }
  if (shape.kind === "function") {
    const math = toMathPoint(closest.position);
    const exact = functionPosition(shape, math.x);
    if (exact === null) {
      return null;
    }
    return { position: exact, parameter: math.x };
  }
  if (shape.kind === "ellipse") {
    const angle = ellipseAngle(shape, closest.position) / FULL_TURN;
    const exact = ellipsePosition(shape, angle);
    if (exact === null) {
      return null;
    }
    return { position: exact, parameter: angle };
  }
  return closest;
}

/** 将新点依附到鼠标附近最近的可见轮廓，找不到轮廓时保持为自由点 */
export function attachNewPoint(
  document: BoardDocument,
  point: Shape,
  pointer: Point,
  zoom: number,
  view: Bounds,
  invisible: ReadonlySet<string>
): void {
  let distance = ATTACH_DISTANCE / zoom;
  for (const shape of document.shapes) {
    if (shape.hidden || shape.opacity === 0 || invisible.has(shape.id) || !canAttachPoint(shape)) {
      continue;
    }
    const bounds = getRotatedBounds(shape);
    const unbounded = shape.kind === "line" && shape.lineType !== "segment";
    const padding = distance + shape.strokeWidth / 2;
    if (
      !unbounded &&
      shape.kind !== "connector" &&
      !hasOpenDomain(shape.formula) &&
      (pointer.x < bounds.x - padding ||
        pointer.x > bounds.x + bounds.width + padding ||
        pointer.y < bounds.y - padding ||
        pointer.y > bounds.y + bounds.height + padding)
    ) {
      continue;
    }
    const match = projectSource(shape, pointer, view);
    if (match === null || !canStoreMatch(match)) {
      continue;
    }
    const gap = Math.hypot(pointer.x - match.position.x, pointer.y - match.position.y);
    // 厚描边也能点中，距离相同时优先后来绘制的对象
    const distanceFromStroke = Math.max(0, gap - shape.strokeWidth / 2);
    if (distanceFromStroke <= distance) {
      distance = distanceFromStroke;
      point.relation = {
        kind: "point-on-outline",
        sources: [shape.id],
        outlinePosition: match.parameter
      };
      point.x = match.position.x;
      point.y = match.position.y;
    }
  }
}

/** 移动已依附的点，找不到有效位置时保留原来的参数 */
export function slideAttachedPoint(
  document: BoardDocument,
  point: Shape,
  pointer: Point,
  view: Bounds
): void {
  const source = findShape(document, point.relation.sources[0]);
  if (source === undefined) {
    return;
  }
  const match = projectSource(source, pointer, view);
  if (match !== null && canStoreMatch(match)) {
    point.relation.outlinePosition = match.parameter;
    point.x = match.position.x;
    point.y = match.position.y;
  }
}

/** 从保存的参数还原点的位置，使来源移动或变形后仍能跟随 */
export function attachedPointPosition(source: Shape, parameter: number): Point | null {
  if (source.kind === "function") {
    return functionPosition(source, parameter);
  }
  if (source.kind === "ellipse") {
    return ellipsePosition(source, parameter);
  }
  if (usesPath(source)) {
    return savedPathPosition(source, parameter);
  }
  if (source.kind === "line" || source.kind === "arrow") {
    if (source.width === 0 && source.height === 0) {
      return null;
    }
    let ratio = parameter;
    if (source.lineType !== "straight") {
      ratio = Math.max(0, ratio);
    }
    if (source.lineType === "segment") {
      ratio = Math.min(1, ratio);
    }
    const ends = getLinePoints(source);
    return between(ends[0], ends[1], ratio);
  }
  const parts = outlineParts(source);
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return null;
  }
  const distance = (last.offset + last.length) * parameter;
  for (const part of parts) {
    const relative = distance - part.offset;
    if (relative <= part.length) {
      return between(part.start, part.end, relative / part.length);
    }
  }
  return last.end;
}
