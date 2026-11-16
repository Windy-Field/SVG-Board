import Flatten from "@flatten-js/core";
import { getLinePoints } from "./geometry";
import { MAX_COORDINATE } from "../core/model";
import type { Bounds, Point, Shape } from "../core/types";

// 小于此值时视为重合点，无法确定直线方向
const MIN_DIRECTION_LENGTH = 0.000001;

/** 将直线或射线裁剪到可见矩形，两次点击的位置仅保存端点和方向 */
export function extendedLinePoints(shape: Shape, bounds?: Bounds): Point[] {
  const points = getLinePoints(shape);
  if (shape.lineType === "segment") {
    return points;
  }
  const directionX = points[1].x - points[0].x;
  const directionY = points[1].y - points[0].y;
  if (Math.hypot(directionX, directionY) < MIN_DIRECTION_LENGTH) {
    return points;
  }
  let area = bounds;
  if (area === undefined) {
    area = {
      x: -MAX_COORDINATE,
      y: -MAX_COORDINATE,
      width: MAX_COORDINATE * 2,
      height: MAX_COORDINATE * 2
    };
  }
  const box = new Flatten.Box(area.x, area.y, area.x + area.width, area.y + area.height);
  const start = new Flatten.Point(points[0].x, points[0].y);
  const end = new Flatten.Point(points[1].x, points[1].y);
  const line = new Flatten.Line(start, end);
  const intersections = line.intersect(box);
  let minimum = Infinity;
  let maximum = -Infinity;
  let first = points[0];
  let last = points[0];
  const squareLength = directionX * directionX + directionY * directionY;
  for (const point of intersections) {
    const distance =
      ((point.x - start.x) * directionX + (point.y - start.y) * directionY) / squareLength;
    if (shape.lineType === "ray" && distance < 0) {
      continue;
    }
    if (distance < minimum) {
      minimum = distance;
      first = { x: point.x, y: point.y };
    }
    if (distance > maximum) {
      maximum = distance;
      last = { x: point.x, y: point.y };
    }
  }
  if (shape.lineType === "ray" && box.contains(start)) {
    first = points[0];
  }
  if (!Number.isFinite(maximum)) {
    return [points[0], points[0]];
  }
  return [first, last];
}
