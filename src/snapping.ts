import Flatten from "@flatten-js/core";
import { getLinePoints } from "./geometry";
import { GRID_SIZE, isLine, getRotatedBounds } from "./model";
import { outlinePoints } from "./outlines";
import type { BoardDocument, Point } from "./types";

// 光标吸附范围，单位为屏幕像素
const SNAP_DISTANCE = 10;

/** 保存光标附近的一段边框，交点只在附近计算 */
interface Edge {
  owner: string;
  segment: Flatten.Segment;
}

/** 返回范围内最近的候选点，吸附到对象后保留其准确坐标 */
function nearestPoint(position: Point, points: Point[], radius: number): Point | null {
  let nearest = radius;
  let result: Point | null = null;
  for (const point of points) {
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    if (distance <= nearest) {
      nearest = distance;
      result = { x: point.x, y: point.y };
    }
  }
  return result;
}

/** 按交点、端点与顶点、边框、网格的顺序吸附，关闭时保留原坐标 */
export function snapPosition(
  document: BoardDocument,
  position: Point,
  enabled: boolean,
  zoom: number,
  excluded: string
): Point {
  if (!enabled) {
    return { x: position.x, y: position.y };
  }
  const radius = SNAP_DISTANCE / zoom;
  const pointer = new Flatten.Point(position.x, position.y);
  const edges: Edge[] = [];
  const vertices: Point[] = [];
  const projections: Point[] = [];
  for (const shape of document.shapes) {
    if (shape.id === excluded || shape.hidden) {
      continue;
    }
    const bounds = getRotatedBounds(shape);
    const outside =
      position.x < bounds.x - radius ||
      position.x > bounds.x + bounds.width + radius ||
      position.y < bounds.y - radius ||
      position.y > bounds.y + bounds.height + radius;
    if (shape.kind !== "connector" && outside) {
      continue;
    }
    if (shape.kind === "point") {
      vertices.push({ x: shape.x, y: shape.y });
      continue;
    }
    const points = outlinePoints(shape);
    if (isLine(shape)) {
      const endpoints = getLinePoints(shape);
      vertices.push(endpoints[0], endpoints[1]);
    } else if (shape.kind !== "ellipse" && shape.kind !== "curve" && shape.kind !== "pencil") {
      for (const point of points) {
        vertices.push(point);
      }
    }
    for (let index = 1; index < points.length; index = index + 1) {
      const start = points[index - 1];
      const end = points[index];
      if (
        position.x < Math.min(start.x, end.x) - radius ||
        position.x > Math.max(start.x, end.x) + radius ||
        position.y < Math.min(start.y, end.y) - radius ||
        position.y > Math.max(start.y, end.y) + radius
      ) {
        continue;
      }
      const segment = new Flatten.Segment(
        new Flatten.Point(start.x, start.y),
        new Flatten.Point(end.x, end.y)
      );
      const distance = pointer.distanceTo(segment);
      if (distance[0] <= radius) {
        projections.push({ x: distance[1].end.x, y: distance[1].end.y });
        edges.push({ owner: shape.id, segment: segment });
      }
    }
  }
  const intersections: Point[] = [];
  for (let first = 0; first < edges.length; first = first + 1) {
    for (let second = first + 1; second < edges.length; second = second + 1) {
      if (edges[first].owner === edges[second].owner) {
        continue;
      }
      const points = edges[first].segment.intersect(edges[second].segment);
      for (const point of points) {
        intersections.push({ x: point.x, y: point.y });
      }
    }
  }
  for (const candidates of [intersections, vertices, projections]) {
    const match = nearestPoint(position, candidates, radius);
    if (match !== null) {
      return match;
    }
  }
  return {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE
  };
}
