import { createFabricLabel, createFabricShape } from "./fabric-shapes";
import type { BoardDocument, Bounds, Shape } from "./types";

export const CONTENT_PADDING = 40;

/** 合并实际显示边界，文字自然高度、旋转与箭头两翼都计入范围 */
export function visualBounds(shapes: Shape[]): Bounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const shape of shapes) {
    if (shape.hidden) {
      continue;
    }
    const object = createFabricShape(shape);
    const label = createFabricLabel(shape);
    const objects = [object];
    if (label !== null) {
      objects.push(label);
    }
    for (const member of objects) {
      const bounds = member.getBoundingRect();
      left = Math.min(left, bounds.left);
      top = Math.min(top, bounds.top);
      right = Math.max(right, bounds.left + bounds.width);
      bottom = Math.max(bottom, bounds.top + bounds.height);
      member.dispose();
    }
  }
  if (!Number.isFinite(left)) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 返回作品的内容范围，画布本身不限制在这个范围内 */
export function contentBounds(document: BoardDocument): Bounds {
  const bounds = visualBounds(document.shapes);
  if (bounds === null) {
    return { x: 0, y: 0, width: 1200, height: 800 };
  }
  return {
    x: bounds.x - CONTENT_PADDING,
    y: bounds.y - CONTENT_PADDING,
    width: Math.max(100, bounds.width + CONTENT_PADDING * 2),
    height: Math.max(100, bounds.height + CONTENT_PADDING * 2)
  };
}

/** 保存内容外框和少量空白，不移动对象坐标，以免破坏构造关系 */
export function prepareDocument(document: BoardDocument): BoardDocument {
  const copy = structuredClone(document);
  const bounds = contentBounds(copy);
  copy.contentBounds = bounds;
  copy.width = Math.min(10000, Math.ceil(bounds.width));
  copy.height = Math.min(10000, Math.ceil(bounds.height));
  return copy;
}
