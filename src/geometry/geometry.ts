import Flatten from "@flatten-js/core";
import { findShape, getBounds, MAX_COORDINATE } from "../core/model";
import type { BoardDocument, Point, Shape } from "../core/types";
import { updateFittedFunction } from "../math/plots";
import { straightOutlineEdges } from "./outlines";
import type { OutlineEdge } from "./outlines";
import { attachedPointPosition } from "./point-attachment";

// 小于此长度时按退化几何处理，单位为画布坐标
const MIN_LENGTH = 0.000001;
// 交点去重沿用几何计算精度，单位为画布坐标
export const SAME_POINT_DISTANCE = MIN_LENGTH;
// 新建平行线和垂线的显示长度
const CONSTRUCTION_LENGTH = 240;
// 构造线可显示的最短长度，单位为画布坐标
export const MIN_CONSTRUCTION_LENGTH = 1;
// 构造线可显示的最长长度，与文件允许的尺寸范围一致
export const MAX_CONSTRUCTION_LENGTH = MAX_COORDINATE;

/** 判断线条是否保留几何构造关系，端点伸缩时仍需沿来源方向 */
export function isConstructionLine(shape: Shape): boolean {
  const kind = shape.relation.kind;
  return (
    kind === "segment" || kind === "parallel" || kind === "perpendicular" || kind === "bisector"
  );
}

/** 将拖动位置投影到构造线，调整一个端点的显示长度并保留来源 */
export function resizeConstructionLine(shape: Shape, index: number, position: Point): boolean {
  if (!isConstructionLine(shape)) {
    return false;
  }
  const points = getLinePoints(shape);
  const length = Math.hypot(shape.width, shape.height);
  if (length < MIN_LENGTH) {
    return false;
  }
  const directionX = (points[1].x - points[0].x) / length;
  const directionY = (points[1].y - points[0].y) / length;
  let distance =
    (position.x - points[index].x) * directionX + (position.y - points[index].y) * directionY;
  let offset = shape.relation.endOffset;
  let minimumDistance = MIN_CONSTRUCTION_LENGTH - length;
  let maximumDistance = MAX_CONSTRUCTION_LENGTH - length;
  if (index === 0) {
    minimumDistance = length - MAX_CONSTRUCTION_LENGTH;
    maximumDistance = length - MIN_CONSTRUCTION_LENGTH;
    offset = shape.relation.startOffset;
  }
  if (offset === undefined) {
    offset = 0;
  }
  minimumDistance = Math.max(minimumDistance, -MAX_COORDINATE - offset);
  maximumDistance = Math.min(maximumDistance, MAX_COORDINATE - offset);
  distance = Math.max(minimumDistance, Math.min(maximumDistance, distance));
  // 只记录沿线方向的位移，鼠标偏离直线时不会改变构造角度
  if (index === 0) {
    shape.relation.startOffset = offset + distance;
  } else {
    shape.relation.endOffset = offset + distance;
  }
  points[index].x = points[index].x + directionX * distance;
  points[index].y = points[index].y + directionY * distance;
  setLine(shape, points[0], points[1]);
  return true;
}

/** 按属性面板给出的长度伸缩终点，起点和构造方向保持不变 */
export function setConstructionLength(shape: Shape, length: number): boolean {
  if (
    !Number.isFinite(length) ||
    length < MIN_CONSTRUCTION_LENGTH ||
    length > MAX_CONSTRUCTION_LENGTH
  ) {
    return false;
  }
  const points = getLinePoints(shape);
  const current = Math.hypot(shape.width, shape.height);
  if (current < MIN_LENGTH) {
    return false;
  }
  const position = {
    x: points[0].x + ((points[1].x - points[0].x) / current) * length,
    y: points[0].y + ((points[1].y - points[0].y) / current) * length
  };
  return resizeConstructionLine(shape, 1, position);
}

/** 返回对象中心，供连接线计算朝向使用 */
export function getCenter(shape: Shape): Point {
  const bounds = getBounds(shape);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** 求旋转图形边界上的连接位置，先转换到局部坐标再转回画布 */
export function getAnchor(shape: Shape, target: Point): Point {
  const center = getCenter(shape);
  const angle = (shape.rotation * Math.PI) / 180;
  const deltaX = target.x - center.x;
  const deltaY = target.y - center.y;
  const localX = deltaX * Math.cos(angle) + deltaY * Math.sin(angle);
  const localY = -deltaX * Math.sin(angle) + deltaY * Math.cos(angle);
  const halfWidth = Math.max(Math.abs(shape.width) / 2, MIN_LENGTH);
  const halfHeight = Math.max(Math.abs(shape.height) / 2, MIN_LENGTH);
  let scale = Math.max(Math.abs(localX) / halfWidth, Math.abs(localY) / halfHeight);
  if (shape.kind === "ellipse") {
    scale = Math.sqrt(
      (localX * localX) / (halfWidth * halfWidth) + (localY * localY) / (halfHeight * halfHeight)
    );
  }
  if (shape.kind === "diamond") {
    scale = Math.abs(localX) / halfWidth + Math.abs(localY) / halfHeight;
  }
  if (scale < MIN_LENGTH) {
    return center;
  }
  const anchorX = localX / scale;
  const anchorY = localY / scale;
  return {
    x: center.x + anchorX * Math.cos(angle) - anchorY * Math.sin(angle),
    y: center.y + anchorX * Math.sin(angle) + anchorY * Math.cos(angle)
  };
}

/** 返回线段旋转后的两个端点，保证交点构造与屏幕上的线一致 */
export function getLinePoints(shape: Shape): Point[] {
  const center = getCenter(shape);
  const radians = (shape.rotation * Math.PI) / 180;
  const offsetX = shape.width / 2;
  const offsetY = shape.height / 2;
  const rotatedX = offsetX * Math.cos(radians) - offsetY * Math.sin(radians);
  const rotatedY = offsetX * Math.sin(radians) + offsetY * Math.cos(radians);
  return [
    { x: center.x - rotatedX, y: center.y - rotatedY },
    { x: center.x + rotatedX, y: center.y + rotatedY }
  ];
}

/** 求两条线所在直线的唯一交点，退化、平行或重合时返回空值 */
function findLineIntersection(first: Shape, second: Shape): Point | null {
  if (Math.hypot(first.width, first.height) < MIN_LENGTH) {
    return null;
  }
  if (Math.hypot(second.width, second.height) < MIN_LENGTH) {
    return null;
  }
  const firstEnds = getLinePoints(first);
  const secondEnds = getLinePoints(second);
  const firstLine = new Flatten.Line(
    new Flatten.Point(firstEnds[0].x, firstEnds[0].y),
    new Flatten.Point(firstEnds[1].x, firstEnds[1].y)
  );
  const secondLine = new Flatten.Line(
    new Flatten.Point(secondEnds[0].x, secondEnds[0].y),
    new Flatten.Point(secondEnds[1].x, secondEnds[1].y)
  );
  const intersections = firstLine.intersect(secondLine);
  if (intersections.length !== 1) {
    return null;
  }
  const intersection = intersections[0];
  return { x: intersection.x, y: intersection.y };
}

/** 判断交点是否在线段的端点之间，给计算误差留出少量余地 */
function isOnLineSegment(line: Shape, position: Point): boolean {
  const ends = getLinePoints(line);
  const left = Math.min(ends[0].x, ends[1].x) - MIN_LENGTH;
  const right = Math.max(ends[0].x, ends[1].x) + MIN_LENGTH;
  const top = Math.min(ends[0].y, ends[1].y) - MIN_LENGTH;
  const bottom = Math.max(ends[0].y, ends[1].y) + MIN_LENGTH;
  return position.x >= left && position.x <= right && position.y >= top && position.y <= bottom;
}

/** 图形边只在实际边长内求交，直接选中的线保留原有的延长求交方式 */
export function findConstructionIntersection(
  first: Shape,
  second: Shape,
  firstIsEdge: boolean,
  secondIsEdge: boolean
): Point | null {
  const position = findLineIntersection(first, second);
  if (position === null) {
    return null;
  }
  if (firstIsEdge && !isOnLineSegment(first, position)) {
    return null;
  }
  if (secondIsEdge && !isOnLineSegment(second, position)) {
    return null;
  }
  return position;
}

/** 判断该来源是否指定了图形上的一条边 */
function hasSourceEdge(shape: Shape, index: number): boolean {
  const edges = shape.relation.sourceEdges;
  return edges !== undefined && typeof edges[index] === "number";
}

/** 返回线的单位方向，图形边在公共端点处朝另一端取方向 */
function bisectorDirection(line: Shape, origin: Point, isEdge: boolean): Point {
  const ends = getLinePoints(line);
  let horizontal = ends[1].x - ends[0].x;
  let vertical = ends[1].y - ends[0].y;
  const length = Math.hypot(horizontal, vertical);
  if (isEdge && Math.hypot(ends[1].x - origin.x, ends[1].y - origin.y) <= MIN_LENGTH) {
    horizontal = -horizontal;
    vertical = -vertical;
  }
  return { x: horizontal / length, y: vertical / length };
}

/** 写入线的起点与方向，构造对象统一使用不旋转的画布坐标 */
function setLine(shape: Shape, start: Point, end: Point): void {
  shape.x = start.x;
  shape.y = start.y;
  shape.width = end.x - start.x;
  shape.height = end.y - start.y;
  shape.rotation = 0;
}

/** 用指定边的两个端点参与直线计算，不改动来源图形 */
export function lineFromOutlineEdge(shape: Shape, edge: OutlineEdge): Shape {
  const line = Object.assign({}, shape);
  line.kind = "line";
  line.lineType = "segment";
  setLine(line, edge.start, edge.end);
  return line;
}

/** 按来源编号找对象，指定边号时用边代替整个图形 */
function relationSource(document: BoardDocument, shape: Shape, index: number): Shape | undefined {
  const relation = shape.relation;
  const source = findShape(document, relation.sources[index]);
  if (source === undefined || relation.sourceEdges === undefined) {
    return source;
  }
  const edge = relation.sourceEdges[index];
  if (edge === null || edge === undefined) {
    return source;
  }
  const edges = straightOutlineEdges(source);
  const outline = edges[edge];
  if (outline === undefined) {
    return undefined;
  }
  const length = Math.hypot(outline.end.x - outline.start.x, outline.end.y - outline.start.y);
  if (length < MIN_LENGTH) {
    return undefined;
  }
  return lineFromOutlineEdge(source, outline);
}

/** 在来源决定的端点上加上显示偏移，来源转动时偏移也沿新方向计算 */
function setConstructionLine(shape: Shape, start: Point, end: Point): void {
  let startOffset = shape.relation.startOffset;
  let endOffset = shape.relation.endOffset;
  if (startOffset === undefined) {
    startOffset = 0;
  }
  if (endOffset === undefined) {
    endOffset = 0;
  }
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < MIN_LENGTH) {
    setLine(shape, start, end);
    return;
  }
  const directionX = (end.x - start.x) / length;
  const directionY = (end.y - start.y) / length;
  // 来源线缩短时也保留正向线段，避免两个端点交叉后方向反转
  endOffset = Math.max(startOffset + MIN_CONSTRUCTION_LENGTH - length, endOffset);
  endOffset = Math.min(startOffset + MAX_CONSTRUCTION_LENGTH - length, endOffset);
  setLine(
    shape,
    { x: start.x + directionX * startOffset, y: start.y + directionY * startOffset },
    { x: end.x + directionX * endOffset, y: end.y + directionY * endOffset }
  );
}

/** 更新一个构造对象，来源缺失或退化时返回 false，不保留错误的可见结果 */
export function updateRelation(document: BoardDocument, shape: Shape): boolean {
  const relation = shape.relation;
  if (relation.kind === "fit") {
    const sources: Shape[] = [];
    for (const id of relation.sources) {
      const source = findShape(document, id);
      if (source === undefined) {
        return false;
      }
      sources.push(source);
    }
    try {
      updateFittedFunction(shape, sources);
      return true;
    } catch {
      return false;
    }
  }
  const first = relationSource(document, shape, 0);
  const second = relationSource(document, shape, 1);
  if (first === undefined) {
    return false;
  }
  if (relation.kind === "point-on-outline") {
    if (relation.outlinePosition === undefined) {
      return false;
    }
    const position = attachedPointPosition(first, relation.outlinePosition);
    if (
      position === null ||
      Math.abs(position.x) > MAX_COORDINATE ||
      Math.abs(position.y) > MAX_COORDINATE
    ) {
      return false;
    }
    shape.x = position.x;
    shape.y = position.y;
    return true;
  }
  if (relation.kind === "label") {
    if (relation.offsetX === undefined || relation.offsetY === undefined) {
      return false;
    }
    shape.x = first.x + relation.offsetX;
    shape.y = first.y + relation.offsetY;
    return true;
  }
  if (relation.kind === "midpoint") {
    const endpoints = getLinePoints(first);
    const segment = new Flatten.Segment(
      new Flatten.Point(endpoints[0].x, endpoints[0].y),
      new Flatten.Point(endpoints[1].x, endpoints[1].y)
    );
    const middle = segment.middle();
    shape.x = middle.x;
    shape.y = middle.y;
    return true;
  }
  if (second === undefined) {
    return false;
  }
  if (relation.kind === "connector") {
    const start = getAnchor(first, getCenter(second));
    const end = getAnchor(second, getCenter(first));
    setLine(shape, start, end);
    return true;
  }
  if (relation.kind === "segment") {
    setConstructionLine(shape, first, second);
    return true;
  }
  const endpoints = getLinePoints(first);
  let directionX = endpoints[1].x - endpoints[0].x;
  let directionY = endpoints[1].y - endpoints[0].y;
  const length = Math.hypot(directionX, directionY);
  if (length < MIN_LENGTH) {
    return false;
  }
  if (relation.kind === "intersection" || relation.kind === "bisector") {
    const firstIsEdge = hasSourceEdge(shape, 0);
    const secondIsEdge = hasSourceEdge(shape, 1);
    const origin = findConstructionIntersection(first, second, firstIsEdge, secondIsEdge);
    if (origin === null) {
      return false;
    }
    if (relation.kind === "intersection") {
      shape.x = origin.x;
      shape.y = origin.y;
      return true;
    }
    // 从顶点沿两条边向外取方向，避免把矩形内角画成外角
    const firstDirection = bisectorDirection(first, origin, firstIsEdge);
    const secondDirection = bisectorDirection(second, origin, secondIsEdge);
    const bisectorX = firstDirection.x + secondDirection.x;
    const bisectorY = firstDirection.y + secondDirection.y;
    const bisectorLength = Math.hypot(bisectorX, bisectorY);
    if (bisectorLength < MIN_LENGTH) {
      return false;
    }
    setConstructionLine(shape, origin, {
      x: origin.x + (bisectorX / bisectorLength) * CONSTRUCTION_LENGTH,
      y: origin.y + (bisectorY / bisectorLength) * CONSTRUCTION_LENGTH
    });
    return true;
  }
  if (relation.kind === "perpendicular") {
    const originalX = directionX;
    directionX = -directionY;
    directionY = originalX;
  }
  const halfX = ((directionX / length) * CONSTRUCTION_LENGTH) / 2;
  const halfY = ((directionY / length) * CONSTRUCTION_LENGTH) / 2;
  setConstructionLine(
    shape,
    { x: second.x - halfX, y: second.y - halfY },
    { x: second.x + halfX, y: second.y + halfY }
  );
  return true;
}

/** 按构造创建顺序重新计算关系，返回当前无法显示的对象编号 */
export function updateRelations(document: BoardDocument): Set<string> {
  const invalid = new Set<string>();
  for (const shape of document.shapes) {
    if (shape.relation.kind === "none") {
      continue;
    }
    let missingSource = false;
    for (const source of shape.relation.sources) {
      if (invalid.has(source)) {
        missingSource = true;
      }
    }
    if (missingSource || !updateRelation(document, shape)) {
      invalid.add(shape.id);
    }
  }
  return invalid;
}

/** 收集来源对象和依赖它们的所有构造，供删除和吸附排除使用 */
export function getDependentIds(document: BoardDocument, selected: string[]): Set<string> {
  const affected = new Set(selected);
  for (const shape of document.shapes) {
    for (const source of shape.relation.sources) {
      if (affected.has(source)) {
        affected.add(shape.id);
        break;
      }
    }
  }
  return affected;
}
