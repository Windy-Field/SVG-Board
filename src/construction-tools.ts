import type { ConstructionTool, Shape } from "./types";

/** 判断当前是否为需要依次选择来源的几何工具 */
export function isConstructionTool(value: string): value is ConstructionTool {
  return (
    value === "segment" ||
    value === "midpoint" ||
    value === "intersection" ||
    value === "parallel" ||
    value === "perpendicular"
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
    if (shape.id === candidate.id) {
      return false;
    }
  }
  if (kind === "segment") {
    return candidate.kind === "point";
  }
  if (kind === "midpoint" || kind === "intersection") {
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

/** 检查现有选区是否满足构造条件，供先选对象的操作方式使用 */
export function validConstructionSources(kind: ConstructionTool, selected: Shape[]): boolean {
  if (selected.length !== constructionSourceCount(kind)) {
    return false;
  }
  const accepted: Shape[] = [];
  for (const shape of selected) {
    if (!acceptsConstructionSource(kind, accepted, shape)) {
      return false;
    }
    accepted.push(shape);
  }
  return true;
}
