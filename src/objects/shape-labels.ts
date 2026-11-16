import { createFabricLabel } from "../canvas/fabric-shapes";
import { createShape, MAX_SHAPES } from "../core/model";
import type { BoardDocument, Shape } from "../core/types";

/** 将图形上的标签转换为独立文字，保留标签当前的外观和位置 */
export function detachLabel(document: BoardDocument, owner: Shape): Shape | null {
  if (owner.kind === "function" || document.shapes.length >= MAX_SHAPES) {
    return null;
  }
  const object = createFabricLabel(owner);
  if (object === null) {
    return null;
  }
  const center = object.getCenterPoint();
  const label = createShape("text", {
    x: center.x - object.width / 2,
    y: center.y - object.height / 2
  });
  label.width = object.width;
  label.height = object.height;
  label.rotation = owner.rotation;
  label.name = owner.text;
  label.text = owner.text;
  label.fontFamily = owner.fontFamily;
  label.fontSize = owner.fontSize;
  label.textAlign = owner.textAlign;
  label.bold = owner.bold;
  label.italic = owner.italic;
  label.underline = owner.underline;
  label.stroke = owner.stroke;
  label.opacity = owner.opacity;
  label.locked = owner.locked;
  label.layer = document.shapes.length;
  owner.text = "";
  document.shapes.push(label);
  object.dispose();
  return label;
}
