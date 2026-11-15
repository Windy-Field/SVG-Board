import type { Point, Shape } from "./types";

const CURVE_BEND_RATIO = 0.3;

/** 按边数生成以外框为范围的正多边形顶点 */
export function regularPoints(width: number, height: number, sides: number): Point[] {
  const points: Point[] = [];
  const radius = Math.min(Math.abs(width), Math.abs(height)) / 2;
  for (let index = 0; index < sides; index = index + 1) {
    const angle = (index * Math.PI * 2) / sides - Math.PI / 2;
    points.push({
      x: Math.abs(width) / 2 + radius * Math.cos(angle),
      y: Math.abs(height) / 2 + radius * Math.sin(angle)
    });
  }
  return points;
}

/** 收紧多边形外框并保留各边比例，避免五边形在矩形外框内被拉长 */
export function fitPolygon(shape: Shape): void {
  const points = shape.points;
  if (points.length < 3) {
    return;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  for (const point of points) {
    point.x = point.x - left;
    point.y = point.y - top;
  }
  shape.x = shape.x + left;
  shape.y = shape.y + top;
  shape.width = Math.max(1, right - left);
  shape.height = Math.max(1, bottom - top);
}

/** 贝塞尔路径由起终点和两个控制点构成，拖动后由 Fabric 负责路径显示 */
export function curvePath(shape: Shape): string {
  const width = shape.width;
  const height = shape.height;
  const bend = Math.hypot(width, height) * CURVE_BEND_RATIO;
  return (
    "M " +
    -width / 2 +
    " " +
    -height / 2 +
    " C " +
    -width / 6 +
    " " +
    (-height / 2 - bend) +
    " " +
    width / 6 +
    " " +
    (height / 2 + bend) +
    " " +
    width / 2 +
    " " +
    height / 2
  );
}
