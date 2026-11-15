import type { BoardDocument } from "./types";

/** 比较作品内容时将随机编号转换为顺序编号，重复导入同一作品只保留一份 */
export function archiveContent(document: BoardDocument): string {
  const copy = structuredClone(document);
  const ids = new Map<string, string>();
  for (let index = 0; index < copy.shapes.length; index = index + 1) {
    ids.set(copy.shapes[index].id, String(index));
  }
  const groups = new Map<string, string>();
  for (const shape of copy.shapes) {
    shape.id = ids.get(shape.id) || "";
    for (let index = 0; index < shape.relation.sources.length; index = index + 1) {
      const source = shape.relation.sources[index];
      shape.relation.sources[index] = ids.get(source) || source;
    }
    if (shape.group !== "") {
      if (!groups.has(shape.group)) {
        groups.set(shape.group, String(groups.size));
      }
      shape.group = groups.get(shape.group) || "";
    }
  }
  // 裁剪范围随保存更新，去重只比较名称、说明和可编辑对象
  let emptySize = "";
  if (copy.shapes.length === 0) {
    emptySize = copy.width + "x" + copy.height;
  }
  return JSON.stringify({
    name: copy.name.trim(),
    description: copy.description,
    shapes: copy.shapes,
    emptySize: emptySize
  });
}
