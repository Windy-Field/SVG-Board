import assert from "node:assert/strict";
import { test } from "node:test";
import { constructShape, deleteShapes, pasteShapes } from "../src/core/commands";
import { parseDocument } from "../src/storage/document";
import {
  getLinePoints,
  resizeConstructionLine,
  setConstructionLength,
  updateRelations
} from "../src/geometry/geometry";
import { createDocument, createShape, History, MAX_NAME_LENGTH } from "../src/core/model";
import { createFlowTemplate, createGeometryTemplate } from "../src/objects/templates";
import { isRecord } from "../src/core/validation";
import { createFunctionShape } from "../src/math/plots";

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
  const legacy: unknown = JSON.parse(JSON.stringify(document));
  if (!isRecord(legacy)) {
    throw new Error("测试作品不是普通对象");
  }
  delete legacy.background;
  assert.equal(parseDocument(JSON.stringify(legacy)).background, "#ffffff");
  document.background = "#e2f3e8";
  assert.equal(parseDocument(JSON.stringify(document)).background, "#e2f3e8");
}
test("画布颜色保存并兼容旧作品", testBackground);

/** 拖动顶点后验证中点自动重算，并保留两点直线的关联 */
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

/** 复制最大长度名称时保留后缀，并保持项目可保存 */
function testCopyNameLimit(): void {
  const document = createDocument();
  const shape = createShape("rect", { x: 100, y: 100 });
  shape.name = "长".repeat(MAX_NAME_LENGTH);
  shape.width = 100;
  shape.height = 50;
  document.shapes.push(shape);
  pasteShapes(document, [shape]);
  assert.equal(document.shapes[1].name.length, MAX_NAME_LENGTH);
  assert.ok(document.shapes[1].name.endsWith(" 副本"));
  parseDocument(JSON.stringify(document));
}
test("复制名称遵守文件长度限制", testCopyNameLimit);

/** 函数的位置由解析式确定，复制不会产生与解析式不一致的坐标偏移 */
function testCopyFunctionPosition(): void {
  const document = createDocument();
  const curve = createFunctionShape({
    expression: "x^2",
    minimum: -2,
    maximum: 2,
    degree: 0,
    coefficients: []
  });
  document.shapes.push(curve);
  pasteShapes(document, [curve]);
  assert.equal(document.shapes[1].x, curve.x);
  assert.equal(document.shapes[1].y, curve.y);
  assert.deepEqual(parseDocument(JSON.stringify(document)).shapes[1], document.shapes[1]);
}
test("复制函数保留解析式对应位置", testCopyFunctionPosition);

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

/** 五种几何构造默认锁定，复制后仍保持锁定和来源关系 */
function testConstructionLocks(): void {
  const document = createDocument();
  const first = createShape("point", { x: 100, y: 100 });
  const second = createShape("point", { x: 300, y: 100 });
  const vertical = createShape("line", { x: 200, y: 0 });
  vertical.height = 200;
  document.shapes.push(first, second, vertical);
  const segment = constructShape(document, [first, second], "segment");
  const midpoint = constructShape(document, [segment], "midpoint");
  const intersection = constructShape(document, [segment, vertical], "intersection");
  const parallel = constructShape(document, [segment, first], "parallel");
  const perpendicular = constructShape(document, [segment, second], "perpendicular");
  const results = [segment, midpoint, intersection, parallel, perpendicular];
  for (const shape of results) {
    assert.equal(shape.locked, true);
  }
  const copies = pasteShapes(document, results);
  for (const shape of document.shapes) {
    if (copies.includes(shape.id)) {
      assert.equal(shape.locked, true);
    }
  }
}
test("几何构造及副本默认锁定", testConstructionLocks);

/** 锁定构造线沿原方向伸缩，来源转动后保持长度、角度和后续中点联动 */
function testConstructionLength(): void {
  const document = createDocument();
  const source = createShape("line", { x: 100, y: 200 });
  source.width = 400;
  const point = createShape("point", { x: 600, y: 300 });
  document.shapes.push(source, point);
  const line = constructShape(document, [source, point], "perpendicular");
  const midpoint = constructShape(document, [line], "midpoint");
  assert.equal(resizeConstructionLine(line, 1, { x: 700, y: 500 }), true);
  updateRelations(document);
  assert.equal(line.x, 600);
  assert.equal(line.width, 0);
  assert.equal(line.height, 320);
  assert.equal(midpoint.y, 340);
  const restored = parseDocument(JSON.stringify(document));
  assert.equal(restored.shapes[2].relation.endOffset, 80);
  source.rotation = 90;
  point.x = 650;
  updateRelations(document);
  assert.ok(Math.abs(line.width + 320) < 0.000001);
  assert.ok(Math.abs(line.height) < 0.000001);
  assert.ok(Math.abs(midpoint.x - 610) < 0.000001);
  assert.equal(setConstructionLength(line, 180), true);
  updateRelations(document);
  assert.ok(Math.abs(Math.hypot(line.width, line.height) - 180) < 0.000001);
  assert.equal(line.relation.kind, "perpendicular");
  assert.equal(line.locked, true);
  const history = new History();
  history.push(document);
  setConstructionLength(line, 260);
  history.push(document);
  const undone = history.undo();
  if (undone === null) {
    throw new Error("缺少伸缩前的历史记录");
  }
  const previous = parseDocument(undone);
  updateRelations(previous);
  assert.ok(
    Math.abs(Math.hypot(previous.shapes[2].width, previous.shapes[2].height) - 180) < 0.000001
  );
}
test("构造线伸缩保存与来源转动联动", testConstructionLength);

/** 两点直线调整方向点后仍可联动，方向点不会因拖动越界而翻转 */
function testSegmentExtent(): void {
  const document = createDocument();
  const first = createShape("point", { x: 100, y: 100 });
  const second = createShape("point", { x: 400, y: 100 });
  document.shapes.push(first, second);
  const segment = constructShape(document, [first, second], "segment");
  resizeConstructionLine(segment, 0, { x: 150, y: 300 });
  updateRelations(document);
  assert.equal(segment.x, 150);
  assert.equal(segment.y, 100);
  assert.equal(segment.width, 250);
  second.x = 100;
  second.y = 400;
  updateRelations(document);
  const endpoints = getLinePoints(segment);
  assert.equal(endpoints[0].x, 100);
  assert.equal(endpoints[0].y, 150);
  assert.equal(endpoints[1].y, 400);
  resizeConstructionLine(segment, 1, { x: 100, y: -500 });
  assert.equal(segment.height, 1);
  assert.equal(segment.relation.kind, "segment");
}
test("两点直线调整保留方向及来源", testSegmentExtent);
