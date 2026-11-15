import { getLinePoints, getCenter, getAnchor } from "./geometry";
import { GRID_SIZE, isLine } from "./model";
import type { BoardDocument, Point } from "./types";

const SNAP_DISTANCE = 10;

/** 优先靠近已有端点或图形中心，网格吸附开启后再对齐网格 */
export function snapPosition(
  document: BoardDocument,
  position: Point,
  grid: boolean,
  zoom: number,
  excluded: string
): Point {
  let result = { x: position.x, y: position.y };
  let nearest = SNAP_DISTANCE / zoom;
  for (const shape of document.shapes) {
    if (shape.id === excluded || shape.hidden) {
      continue;
    }
    let candidates: Point[] = [getCenter(shape)];
    if (isLine(shape)) {
      candidates = getLinePoints(shape);
    } else if (shape.kind === "rect" || shape.kind === "ellipse" || shape.kind === "diamond") {
      const center = getCenter(shape);
      candidates.push(getAnchor(shape, { x: center.x - 1000, y: center.y }));
      candidates.push(getAnchor(shape, { x: center.x + 1000, y: center.y }));
      candidates.push(getAnchor(shape, { x: center.x, y: center.y - 1000 }));
      candidates.push(getAnchor(shape, { x: center.x, y: center.y + 1000 }));
    }
    for (const candidate of candidates) {
      const distance = Math.hypot(position.x - candidate.x, position.y - candidate.y);
      if (distance < nearest) {
        result = { x: candidate.x, y: candidate.y };
        nearest = distance;
      }
    }
  }
  if (grid) {
    result.x = Math.round(result.x / GRID_SIZE) * GRID_SIZE;
    result.y = Math.round(result.y / GRID_SIZE) * GRID_SIZE;
  }
  return result;
}
