import Flatten from "@flatten-js/core";
import { findShape, getBounds, MAX_COORDINATE } from "../core/model";
import type { BoardDocument, Point, Shape } from "../core/types";
import { updateFittedFunction } from "../math/plots";

// 小于此长度时按退化几何处理，单位为画布坐标
const MIN_LENGTH = 0.000001;
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

/** 写入线的起点与方向，构造对象统一使用不旋转的画布坐标 */
function setLine(shape: Shape, start: Point, end: Point): void {
  shape.x = start.x;
  shape.y = start.y;
  shape.width = end.x - start.x;
  shape.height = end.y - start.y;
  shape.rotation = 0;
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
function updateRelation(document: BoardDocument, shape: Shape): boolean {
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
  const first = findShape(document, relation.sources[0]);
  const second = findShape(document, relation.sources[1]);
  if (first === undefined) {
    return false;
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
    const other = getLinePoints(second);
    if (Math.hypot(other[1].x - other[0].x, other[1].y - other[0].y) < MIN_LENGTH) {
      return false;
    }
    const firstLine = new Flatten.Line(
      new Flatten.Point(endpoints[0].x, endpoints[0].y),
      new Flatten.Point(endpoints[1].x, endpoints[1].y)
    );
    const secondLine = new Flatten.Line(
      new Flatten.Point(other[0].x, other[0].y),
      new Flatten.Point(other[1].x, other[1].y)
    );
    const intersections = firstLine.intersect(secondLine);
    if (intersections.length !== 1) {
      return false;
    }
    if (relation.kind === "intersection") {
      shape.x = intersections[0].x;
      shape.y = intersections[0].y;
      return true;
    }
    // 两条单位方向向量相加得到一条角平分线，反向时改取另一方向
    const otherLength = Math.hypot(other[1].x - other[0].x, other[1].y - other[0].y);
    let bisectorX = directionX / length + (other[1].x - other[0].x) / otherLength;
    let bisectorY = directionY / length + (other[1].y - other[0].y) / otherLength;
    let bisectorLength = Math.hypot(bisectorX, bisectorY);
    if (bisectorLength < MIN_LENGTH) {
      bisectorX = directionX / length - (other[1].x - other[0].x) / otherLength;
      bisectorY = directionY / length - (other[1].y - other[0].y) / otherLength;
      bisectorLength = Math.hypot(bisectorX, bisectorY);
    }
    const origin = intersections[0];
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

/** 收集删除对象及其所有后续构造，防止保存时留下悬空关系 */
export function getDeletionIds(document: BoardDocument, selected: string[]): Set<string> {
  const deleted = new Set(selected);
  for (const shape of document.shapes) {
    for (const source of shape.relation.sources) {
      if (deleted.has(source)) {
        deleted.add(shape.id);
      }
    }
  }
  return deleted;
}
