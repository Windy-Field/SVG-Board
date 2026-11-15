import Flatten from "@flatten-js/core";
import { outlinePoints } from "./outlines";
import type { Bounds, Shape } from "./types";

/** 用可见笔画与框选矩形求交，细线的空白外框不参与判断 */
export function strokeInMarquee(shape: Shape, bounds: Bounds): boolean {
  const box = new Flatten.Box(
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height
  );
  const points = outlinePoints(shape);
  for (const point of points) {
    if (box.contains(new Flatten.Point(point.x, point.y))) {
      return true;
    }
  }
  for (let index = 1; index < points.length; index = index + 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = new Flatten.Segment(
      new Flatten.Point(start.x, start.y),
      new Flatten.Point(end.x, end.y)
    );
    if (segment.intersect(box).length > 0) {
      return true;
    }
  }
  return false;
}
