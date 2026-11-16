import assert from "node:assert/strict";
import { test } from "node:test";
import { constructShape, deleteShapes, pasteShapes } from "../src/commands";
import { parseDocument } from "../src/document";
import { updateRelations } from "../src/geometry";
import { createDocument, createShape, History } from "../src/model";
import { createFlowTemplate, createGeometryTemplate } from "../src/templates";

/** 验证两个模板都符合保存格式，重新打开后不丢失对象和关系 */
function testRoundTrip(): void {
  const templates = [createFlowTemplate(), createGeometryTemplate()];
  for (const document of templates) {
    const restored = parseDocument(JSON.stringify(document));
    assert.deepEqual(restored, document);
  }
}
test("模板文件可完整往返", testRoundTrip);

/** 旧作品默认使用白色画布，新作品的画布颜色可完整保存 */
function testBackground(): void {
  const document = createDocument();
  const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  delete legacy.background;
  assert.equal(parseDocument(JSON.stringify(legacy)).background, "#ffffff");
  document.background = "#e2f3e8";
  assert.equal(parseDocument(JSON.stringify(document)).background, "#e2f3e8");
}
test("画布颜色保存并兼容旧作品", testBackground);

/** 拖动顶点后验证中点自动重算，并保留两点线段的关联 */
function testMidpoint(): void {
  const document = createGeometryTemplate();
  const vertex = document.shapes[2];
  vertex.x = 400;
  updateRelations(document);
  const midpoint = document.shapes[7];
  assert.equal(midpoint.x, (400 + 890) / 2);
  assert.equal(midpoint.y, 570);
}
test("拖动顶点保持中点关系", testMidpoint);

/** 隐藏来源只改变显示开关，关联几何仍继续计算 */
function testHiddenSource(): void {
  const document = createGeometryTemplate();
  const source = document.shapes[2];
  source.hidden = true;
  source.x = 400;
  const invalid = updateRelations(document);
  assert.equal(invalid.size, 0);
  assert.equal(document.shapes[7].hidden, false);
  assert.equal(document.shapes[7].x, (400 + 890) / 2);
}
test("隐藏来源保留关联对象显示与计算", testHiddenSource);

/** 两条线平行时交点失效，恢复相交后再次计算位置 */
function testIntersection(): void {
  const document = createDocument();
  const first = createShape("line", { x: 0, y: 0 });
  first.width = 100;
  const second = createShape("line", { x: 50, y: -50 });
  second.height = 100;
  document.shapes.push(first, second);
  const point = constructShape(document, [first, second], "intersection");
  assert.equal(point.x, 50);
  assert.equal(point.y, 0);
  second.width = 100;
  second.height = 0;
  assert.equal(updateRelations(document).has(point.id), true);
  second.width = 0;
  second.height = 100;
  assert.equal(updateRelations(document).has(point.id), false);
}
test("交点退化与恢复", testIntersection);

/** 复制完整几何图后，副本的构造必须指向副本来源 */
function testCopyRelations(): void {
  const document = createGeometryTemplate();
  const count = document.shapes.length;
  pasteShapes(document, document.shapes);
  assert.equal(document.shapes.length, count * 2);
  const restored = parseDocument(JSON.stringify(document));
  const copiedPoint = restored.shapes[count + 7];
  assert.equal(copiedPoint.relation.sources[0], restored.shapes[count + 6].id);
}
test("复制保留内部依赖", testCopyRelations);

/** 删除来源会同时删除后续构造，剩余文件仍应通过校验 */
function testDeleteRelations(): void {
  const document = createGeometryTemplate();
  const removed = deleteShapes(document, [document.shapes[2].id]);
  assert.equal(removed, 7);
  parseDocument(JSON.stringify(document));
}
test("删除不留下悬空关系", testDeleteRelations);

/** 验证撤销、重做和撤销后产生新分支的行为 */
function testHistory(): void {
  const history = new History();
  const document = createDocument();
  history.push(document);
  document.name = "第二步";
  history.push(document);
  const snapshot = history.undo();
  assert.notEqual(snapshot, null);
  assert.equal(history.canRedo(), true);
  document.name = "新分支";
  history.push(document);
  assert.equal(history.canRedo(), false);
}
test("撤销与分支历史", testHistory);

/** 拒绝指向外部来源的关系，未知文件不能绕过模型校验 */
function testInvalidDocument(): void {
  const document = createFlowTemplate();
  document.shapes[8].relation.sources[0] = "missing";
  /** 让断言工具调用真实解析过程 */
  function parseInvalid(): void {
    parseDocument(JSON.stringify(document));
  }
  assert.throws(parseInvalid);
}
test("拒绝损坏的构造来源", testInvalidDocument);
