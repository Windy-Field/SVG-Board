import type { ConstructionTool, Shape } from "../core/types";

/** 判断当前是否为需要依次选择来源的几何工具 */
export function isConstructionTool(value: string): value is ConstructionTool {
  return (
    value === "segment" ||
    value === "midpoint" ||
    value === "intersection" ||
    value === "parallel" ||
    value === "perpendicular" ||
    value === "bisector"
  );
}

/** 返回构造所需的对象数量 */
export function constructionSourceCount(kind: ConstructionTool): number {
  if (kind === "midpoint") {
    return 1;
  }
  return 2;
}

/** 检查本次点击的对象能否作为下一个来源，线与点允许任意先后顺序 */
export function acceptsConstructionSource(
  kind: ConstructionTool,
  selected: Shape[],
  candidate: Shape
): boolean {
  for (const shape of selected) {
    if (shape === candidate) {
      return false;
    }
  }
  if (kind === "segment") {
    return candidate.kind === "point";
  }
  if (kind === "midpoint" || kind === "intersection" || kind === "bisector") {
    return candidate.kind === "line";
  }
  if (candidate.kind !== "point" && candidate.kind !== "line") {
    return false;
  }
  if (selected.length === 0) {
    return true;
  }
  return selected[0].kind !== candidate.kind;
}

/** 检查选区能否构造，文字等无关对象不参与批量配对 */
export function validConstructionSources(
  kind: ConstructionTool,
  selected: Shape[],
  includesEdges: boolean = false
): boolean {
  let points = 0;
  let lines = 0;
  for (const shape of selected) {
    if (shape.kind === "point") {
      points = points + 1;
    } else if (shape.kind === "line") {
      lines = lines + 1;
    }
  }
  if (kind === "segment") {
    return points === 2;
  }
  if (kind === "bisector") {
    return lines === 2 || (includesEdges && lines > 2);
  }
  if (kind === "midpoint") {
    return lines > 0;
  }
  if (kind === "intersection") {
    return lines >= 2;
  }
  return lines > 0 && points > 0;
}
