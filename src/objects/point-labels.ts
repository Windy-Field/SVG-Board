import { createShape, MAX_SHAPES } from "../core/model";
import type { BoardDocument, Shape } from "../core/types";

// 点名相对点中心的默认水平偏移
const LABEL_OFFSET_X = 10;
// 点名相对点中心的默认垂直偏移
const LABEL_OFFSET_Y = -30;
// 点名文本框的最小宽度
const LABEL_MIN_WIDTH = 40;
// 点名行高相对字号的比例
const LABEL_LINE_HEIGHT = 1.2;
// 点名按字母表循环，第二轮起在字母后加轮次编号
const POINT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 分配尚未使用的点名，批量创建时也检查尚未写入作品的点 */
export function nextPointName(document: BoardDocument, pending: Shape[] = []): string {
  const used = new Set<string>();
  for (const shapes of [document.shapes, pending]) {
    for (const shape of shapes) {
      if (shape.kind === "point") {
        used.add(shape.name);
        used.add(shape.text);
      } else if (shape.relation.kind === "label") {
        used.add(shape.text);
      }
    }
  }
  let index = 0;
  while (true) {
    const round = Math.floor(index / POINT_ALPHABET.length);
    let name = POINT_ALPHABET[index % POINT_ALPHABET.length];
    if (round > 0) {
      name = name + round;
    }
    if (!used.has(name)) {
      return name;
    }
    index = index + 1;
  }
}

/** 将点名建成独立文本框，默认跟随点移动，也可单独调整与隐藏 */
export function addPointLabel(document: BoardDocument, point: Shape): Shape | null {
  if (point.kind !== "point" || point.text === "" || document.shapes.length >= MAX_SHAPES) {
    return null;
  }
  const label = createShape("text", { x: point.x + LABEL_OFFSET_X, y: point.y + LABEL_OFFSET_Y });
  label.name = point.text;
  label.text = point.text;
  label.width = Math.max(LABEL_MIN_WIDTH, point.text.length * point.fontSize);
  label.height = point.fontSize * LABEL_LINE_HEIGHT;
  label.fontSize = point.fontSize;
  label.fontFamily = point.fontFamily;
  label.stroke = point.stroke;
  label.opacity = point.opacity;
  label.hidden = point.hidden;
  label.textAlign = "start";
  label.layer = document.shapes.length;
  label.relation = {
    kind: "label",
    sources: [point.id],
    offsetX: LABEL_OFFSET_X,
    offsetY: LABEL_OFFSET_Y
  };
  point.text = "";
  document.shapes.push(label);
  return label;
}

/** 旧作品读取后将点名迁移为普通文本，原有独立标签保持原样 */
export function convertPointLabels(document: BoardDocument): void {
  const shapes = document.shapes.slice();
  for (const shape of shapes) {
    // 旧版坐标点以坐标串命名且没有点名文本，读取时补齐，已命名的点保持原样
    if (
      shape.kind === "point" &&
      shape.coordinatePoint &&
      shape.text === "" &&
      /^\(/.test(shape.name)
    ) {
      let hasLabel = false;
      for (const candidate of document.shapes) {
        if (candidate.relation.kind === "label" && candidate.relation.sources[0] === shape.id) {
          hasLabel = true;
        }
      }
      if (!hasLabel) {
        shape.name = nextPointName(document);
        shape.text = shape.name;
      }
    }
    addPointLabel(document, shape);
  }
}
