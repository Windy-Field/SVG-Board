import { createShape, MAX_SHAPES } from "./model";
import type { BoardDocument, Shape } from "./types";

/** 将点名建成独立文本框，默认跟随点移动，也可单独调整与隐藏 */
export function addPointLabel(document: BoardDocument, point: Shape): Shape | null {
  if (point.kind !== "point" || point.text === "" || document.shapes.length >= MAX_SHAPES) {
    return null;
  }
  const label = createShape("text", { x: point.x + 10, y: point.y - 30 });
  label.name = point.text;
  label.text = point.text;
  label.width = Math.max(40, point.text.length * point.fontSize);
  label.height = point.fontSize * 1.2;
  label.fontSize = point.fontSize;
  label.fontFamily = point.fontFamily;
  label.stroke = point.stroke;
  label.hidden = point.hidden;
  label.textAlign = "start";
  label.layer = document.shapes.length;
  label.relation = { kind: "label", sources: [point.id], offsetX: 10, offsetY: -30 };
  point.text = "";
  document.shapes.push(label);
  return label;
}

/** 旧作品读取后将点名迁移为普通文本，原有独立标签保持原样 */
export function convertPointLabels(document: BoardDocument): void {
  const shapes = document.shapes.slice();
  for (const shape of shapes) {
    addPointLabel(document, shape);
  }
}
