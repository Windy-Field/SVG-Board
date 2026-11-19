import { prepareConstruction } from "./commands";
import { MAX_COORDINATE, MAX_SHAPES } from "./model";
import type { BoardDocument, ConstructionTool, Point, Shape } from "./types";
import {
  findLineIntersection,
  SAME_POINT_DISTANCE,
  updateRelation,
  updateRelations
} from "../geometry/geometry";
import { addPointLabel } from "../objects/point-labels";
import { validConstructionSources } from "../geometry/construction-tools";

// 每次命令最多检查的来源组合数，避免大选区卡住画布
const MAX_CONSTRUCTION_PAIRS = 20000;

/** 保存批量构造的结果和未生成对象的原因 */
export interface ConstructionResult {
  created: Shape[];
  duplicates: number;
  invalid: number;
}

/** 按选区生成构造，通过容量检查后再把整批结果加入作品 */
export function constructSelection(
  document: BoardDocument,
  selected: Shape[],
  kind: ConstructionTool
): ConstructionResult {
  if (!validConstructionSources(kind, selected)) {
    throw new Error("请选择该构造需要的点或线");
  }
  const invalidSources = updateRelations(document);
  const staged = Object.assign({}, document);
  staged.shapes = document.shapes.slice();
  const result: ConstructionResult = { created: [], duplicates: 0, invalid: 0 };
  const points: Shape[] = [];
  const lines: Shape[] = [];
  const positions: Point[] = [];
  for (const shape of selected) {
    if (shape.kind === "point") {
      points.push(shape);
    } else if (shape.kind === "line") {
      lines.push(shape);
    }
  }
  if (kind === "intersection") {
    const pairs = (lines.length * (lines.length - 1)) / 2;
    checkPairLimit(pairs);
    // 已有的有效点也参与去重，包括用户手动画出的点
    for (const shape of document.shapes) {
      if (shape.kind === "point" && !invalidSources.has(shape.id)) {
        positions.push(shape);
      }
    }
    for (let first = 0; first < lines.length; first = first + 1) {
      for (let second = first + 1; second < lines.length; second = second + 1) {
        addConstruction([lines[first], lines[second]]);
      }
    }
  } else if (kind === "parallel" || kind === "perpendicular") {
    checkPairLimit(lines.length * points.length);
    for (const line of lines) {
      for (const point of points) {
        addConstruction([line, point]);
      }
    }
  } else if (kind === "midpoint") {
    for (const line of lines) {
      addConstruction([line]);
    }
  } else if (kind === "segment") {
    addConstruction(points);
  } else {
    addConstruction(lines);
  }
  if (result.created.length > 0) {
    document.shapes = staged.shapes;
  }
  return result;

  /** 校验一组来源，暂存构造及其点名，方便整批提交或放弃 */
  function addConstruction(sources: Shape[]): void {
    for (const source of sources) {
      if (invalidSources.has(source.id)) {
        result.invalid = result.invalid + 1;
        return;
      }
    }
    let intersection: Point | null = null;
    if (kind === "intersection") {
      intersection = findLineIntersection(sources[0], sources[1]);
      if (intersection === null || !canStorePosition(intersection)) {
        result.invalid = result.invalid + 1;
        return;
      }
      if (hasPointAt(positions, intersection)) {
        result.duplicates = result.duplicates + 1;
        return;
      }
    }
    const shape = prepareConstruction(staged, sources, kind);
    if (intersection !== null) {
      shape.x = intersection.x;
      shape.y = intersection.y;
    } else if (!updateRelation(staged, shape) || !canStorePosition(shape) || !canStoreSize(shape)) {
      result.invalid = result.invalid + 1;
      return;
    }
    let slots = 1;
    if (shape.kind === "point") {
      slots = 2;
    }
    if (staged.shapes.length + slots > MAX_SHAPES) {
      throw new Error("批量构造会超过画板的对象上限，未添加对象");
    }
    staged.shapes.push(shape);
    const label = addPointLabel(staged, shape);
    if (label !== null && !canStorePosition(label)) {
      staged.shapes.pop();
      staged.shapes.pop();
      result.invalid = result.invalid + 1;
      return;
    }
    result.created.push(shape);
    if (intersection !== null) {
      positions.push(shape);
    }
  }
}

/** 在遍历配对前拦截过大的选区，保留原作品 */
function checkPairLimit(count: number): void {
  if (count > MAX_CONSTRUCTION_PAIRS) {
    throw new Error("所选对象的配对过多，请缩小选区后再试");
  }
}

/** 构造线端点差不能超过项目文件允许的尺寸 */
function canStoreSize(shape: Shape): boolean {
  return Math.abs(shape.width) <= MAX_COORDINATE && Math.abs(shape.height) <= MAX_COORDINATE;
}

/** 判断坐标是否在项目文件允许的范围内 */
function canStorePosition(point: Point): boolean {
  return Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE;
}

/** 判断该位置已有点，只容许几何计算引起的微小误差 */
function hasPointAt(positions: Point[], target: Point): boolean {
  for (const point of positions) {
    if (Math.hypot(point.x - target.x, point.y - target.y) <= SAME_POINT_DISTANCE) {
      return true;
    }
  }
  return false;
}
