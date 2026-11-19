import { getDependentIds, updateRelations } from "../geometry/geometry";
import { compareLayers } from "./model";
import {
  createShape,
  getBounds,
  isDependent,
  MAX_SHAPES,
  MAX_NAME_LENGTH,
  moveShape,
  resizeShape
} from "./model";
import type { BoardDocument, ConstructionTool, Shape } from "./types";
import { nextPointName } from "../objects/point-labels";

// 粘贴副本相对原对象的偏移，单位为画布坐标
const PASTE_OFFSET = 24;
// 几何构造对象的默认颜色
const CONSTRUCTION_COLOR = "#148063";
// 复制对象的名称后缀，超过名称上限时先截短原名称
const COPY_SUFFIX = " 副本";

/** 删除选中对象和依赖它们的构造，返回被删除的对象数量 */
export function deleteShapes(document: BoardDocument, selectedIds: string[]): number {
  const deleted = getDependentIds(document, selectedIds);
  const remaining: Shape[] = [];
  for (const shape of document.shapes) {
    if (!deleted.has(shape.id)) {
      remaining.push(shape);
    }
  }
  document.shapes = remaining;
  return deleted.size;
}

/** 复制完整选区，内部依赖映射到副本，外部依赖保持指向原对象 */
export function pasteShapes(document: BoardDocument, clipboard: Shape[]): string[] {
  if (document.shapes.length + clipboard.length > MAX_SHAPES) {
    throw new Error("粘贴后对象数量超过上限");
  }
  const copies = structuredClone(clipboard);
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const shape of copies) {
    ids.set(shape.id, crypto.randomUUID());
    if (shape.group !== "" && !groups.has(shape.group)) {
      groups.set(shape.group, crypto.randomUUID());
    }
  }
  const selected: string[] = [];
  for (const shape of copies) {
    const id = ids.get(shape.id);
    if (id === undefined) {
      continue;
    }
    shape.id = id;
    const name = shape.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length);
    shape.name = name + COPY_SUFFIX;
    if (!isDependent(shape) && shape.kind !== "function") {
      shape.locked = false;
    }
    const group = groups.get(shape.group);
    if (group !== undefined) {
      shape.group = group;
    }
    for (let index = 0; index < shape.relation.sources.length; index = index + 1) {
      const source = ids.get(shape.relation.sources[index]);
      if (source !== undefined) {
        shape.relation.sources[index] = source;
      }
    }
    if (!isDependent(shape) && shape.kind !== "function") {
      moveShape(shape, PASTE_OFFSET, PASTE_OFFSET);
    }
    shape.layer = document.shapes.length;
    document.shapes.push(shape);
    selected.push(shape.id);
  }
  updateRelations(document);
  return selected;
}

/** 按水平位置排序，供等距分布复用 */
function comparePositions(first: Shape, second: Shape): number {
  return getBounds(first).x - getBounds(second).x;
}

/** 对自由对象执行确定的对齐与分布，不改变锁定或依赖对象 */
export function arrangeShapes(shapes: Shape[], action: string): void {
  const movable: Shape[] = [];
  for (const shape of shapes) {
    if (!shape.locked && !isDependent(shape)) {
      movable.push(shape);
    }
  }
  if (movable.length < 2) {
    throw new Error("请至少选择两个可移动对象");
  }
  const first = getBounds(movable[0]);
  if (action === "distribute") {
    if (movable.length < 3) {
      throw new Error("等距分布需要至少三个对象");
    }
    movable.sort(comparePositions);
    const left = getBounds(movable[0]).x;
    const last = getBounds(movable[movable.length - 1]);
    const right = last.x + last.width;
    let totalWidth = 0;
    for (const shape of movable) {
      totalWidth = totalWidth + getBounds(shape).width;
    }
    const gap = (right - left - totalWidth) / (movable.length - 1);
    let position = left;
    for (const shape of movable) {
      const bounds = getBounds(shape);
      moveShape(shape, position - bounds.x, 0);
      position = position + bounds.width + gap;
    }
    return;
  }
  for (const shape of movable) {
    const bounds = getBounds(shape);
    if (action === "align-left") {
      moveShape(shape, first.x - bounds.x, 0);
    } else if (action === "align-top") {
      moveShape(shape, 0, first.y - bounds.y);
    } else if (action === "same-width") {
      resizeShape(shape, first.width, shape.height);
    }
  }
}

/** 交换相邻的未选中对象，最后重新编号，避免相同层级导致操作没有效果 */
export function changeLayers(document: BoardDocument, selectedIds: string[], raise: boolean): void {
  const ordered = document.shapes.slice();
  ordered.sort(compareLayers);
  if (raise) {
    for (let index = ordered.length - 2; index >= 0; index = index - 1) {
      if (selectedIds.includes(ordered[index].id) && !selectedIds.includes(ordered[index + 1].id)) {
        const neighbor = ordered[index + 1];
        ordered[index + 1] = ordered[index];
        ordered[index] = neighbor;
      }
    }
  } else {
    for (let index = 1; index < ordered.length; index = index + 1) {
      if (selectedIds.includes(ordered[index].id) && !selectedIds.includes(ordered[index - 1].id)) {
        const neighbor = ordered[index - 1];
        ordered[index - 1] = ordered[index];
        ordered[index] = neighbor;
      }
    }
  }
  for (let index = 0; index < ordered.length; index = index + 1) {
    ordered[index].layer = index;
  }
}

/** 根据选择创建几何对象，平行线和垂线统一保存为线在前、点在后 */
export function constructShape(
  document: BoardDocument,
  selected: Shape[],
  kind: ConstructionTool
): Shape {
  if (document.shapes.length >= MAX_SHAPES) {
    throw new Error("对象数量已达上限");
  }
  const shape = prepareConstruction(document, selected, kind);
  document.shapes.push(shape);
  updateRelations(document);
  return shape;
}

/** 创建尚未加入作品的构造对象，统一设置名称、样式和来源顺序 */
export function prepareConstruction(
  document: BoardDocument,
  selected: Shape[],
  kind: ConstructionTool,
  sourceEdges?: ReadonlyMap<Shape, number>
): Shape {
  const points: Shape[] = [];
  const lines: Shape[] = [];
  for (const shape of selected) {
    if (shape.kind === "point") {
      points.push(shape);
    }
    if (shape.kind === "line") {
      lines.push(shape);
    }
  }
  const sources: string[] = [];
  let shape = createShape("line", { x: 0, y: 0 });
  if (kind === "segment" && points.length === 2 && selected.length === 2) {
    sources.push(points[0].id, points[1].id);
    const name = points[0].name + points[1].name;
    shape.name = name.slice(0, MAX_NAME_LENGTH);
  } else if (kind === "midpoint" && lines.length === 1 && selected.length === 1) {
    shape = createShape("point", { x: 0, y: 0 });
    sources.push(lines[0].id);
    shape.name = nextPointName(document);
    shape.text = shape.name;
  } else if (kind === "intersection" && lines.length === 2 && selected.length === 2) {
    shape = createShape("point", { x: 0, y: 0 });
    sources.push(lines[0].id, lines[1].id);
    shape.name = nextPointName(document);
    shape.text = shape.name;
  } else if (kind === "bisector" && lines.length === 2 && selected.length === 2) {
    sources.push(lines[0].id, lines[1].id);
    shape.name = "角平分线";
  } else if (
    (kind === "parallel" || kind === "perpendicular") &&
    lines.length === 1 &&
    points.length === 1 &&
    selected.length === 2
  ) {
    sources.push(lines[0].id, points[0].id);
    shape.name = "平行线";
    if (kind === "perpendicular") {
      shape.name = "垂线";
    }
    shape.dash = true;
    shape.auxiliary = true;
  } else {
    let message = "请选择一条线和一个点";
    if (kind === "segment") {
      message = "请选择两个点";
    } else if (kind === "midpoint") {
      message = "请选择一条线";
    } else if (kind === "intersection" || kind === "bisector") {
      message = "请选择两条线";
    }
    throw new Error(message);
  }
  shape.stroke = CONSTRUCTION_COLOR;
  shape.fill = "none";
  shape.relation = { kind: kind, sources: sources };
  if (sourceEdges !== undefined && sourceEdges.size > 0) {
    const relationEdges: (number | null)[] = [];
    let hasEdge = false;
    // 关系总是先写线、再写点，同一图形的不同边也各占一个位置
    for (const line of lines) {
      const edge = sourceEdges.get(line);
      if (edge === undefined) {
        relationEdges.push(null);
      } else {
        relationEdges.push(edge);
        hasEdge = true;
      }
    }
    if (hasEdge) {
      while (relationEdges.length < sources.length) {
        relationEdges.push(null);
      }
      shape.relation.sourceEdges = relationEdges;
    }
  }
  shape.locked = true;
  if (shape.kind === "line") {
    shape.lineType = "straight";
  }
  shape.layer = document.shapes.length;
  return shape;
}
