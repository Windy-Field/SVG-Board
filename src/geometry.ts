import Flatten from "@flatten-js/core";
import { findShape, getBounds } from "./model";
import type { BoardDocument, Point, Shape } from "./types";

const MIN_LENGTH = 0.000001;
const CONSTRUCTION_LENGTH = 240;

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

/** 更新一个构造对象，来源缺失或退化时返回 false，不保留错误的可见结果 */
function updateRelation(document: BoardDocument, shape: Shape): boolean {
  const relation = shape.relation;
  const first = findShape(document, relation.sources[0]);
  const second = findShape(document, relation.sources[1]);
  if (first === undefined || first.hidden) {
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
  if (second === undefined || second.hidden) {
    return false;
  }
  if (relation.kind === "connector") {
    const start = getAnchor(first, getCenter(second));
    const end = getAnchor(second, getCenter(first));
    setLine(shape, start, end);
    return true;
  }
  if (relation.kind === "segment") {
    setLine(shape, first, second);
    return true;
  }
  const endpoints = getLinePoints(first);
  let directionX = endpoints[1].x - endpoints[0].x;
  let directionY = endpoints[1].y - endpoints[0].y;
  const length = Math.hypot(directionX, directionY);
  if (length < MIN_LENGTH) {
    return false;
  }
  if (relation.kind === "intersection") {
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
    shape.x = intersections[0].x;
    shape.y = intersections[0].y;
    return true;
  }
  if (relation.kind === "perpendicular") {
    const originalX = directionX;
    directionX = -directionY;
    directionY = originalX;
  }
  const halfX = ((directionX / length) * CONSTRUCTION_LENGTH) / 2;
  const halfY = ((directionY / length) * CONSTRUCTION_LENGTH) / 2;
  setLine(
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
