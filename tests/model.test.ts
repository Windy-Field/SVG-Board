import assert from "node:assert/strict";
import { test } from "node:test";
import { constructShape, deleteShapes, pasteShapes } from "../src/core/commands";
import { parseDocument } from "../src/storage/document";
import {
  getLinePoints,
  lineFromOutlineEdge,
  resizeConstructionLine,
  setConstructionLength,
  updateRelations
} from "../src/geometry/geometry";
import {
  createDocument,
  createShape,
  History,
  MAX_NAME_LENGTH,
  MAX_SHAPES
} from "../src/core/model";
import { constructSelection, expandConstructionSelection } from "../src/core/construction-batch";
import { straightOutlineEdges } from "../src/geometry/outlines";
import { attachNewPoint, slideAttachedPoint } from "../src/geometry/point-attachment";
import { createFlowTemplate, createGeometryTemplate } from "../src/objects/templates";
import { isRecord } from "../src/core/validation";
import { createFunctionShape } from "../src/math/plots";
import type { ConstructionTool } from "../src/core/types";

/** 验证两个模板都符合保存格式，重新打开后不丢失对象和关系 */
function testRoundTrip(): void {
  const templates = [createFlowTemplate(), createGeometryTemplate()];
  for (const document of templates) {
    const restored = parseDocument(JSON.stringify(document));
    assert.deepEqual(restored, document);
  }
}
test("模板文件可完整往返", testRoundTrip);

/** 共点的多对直线只生成一个交点，已有点也不重复添加 */
function testBatchIntersections(): void {
  const board = createDocument();
  const horizontal = createShape("line", { x: 0, y: 100 });
  horizontal.width = 200;
  const vertical = createShape("line", { x: 100, y: 0 });
  vertical.height = 200;
  const diagonal = createShape("line", { x: 0, y: 0 });
  diagonal.width = 200;
  diagonal.height = 200;
  const parallel = createShape("line", { x: 0, y: 120 });
  parallel.width = 200;
  const existing = createShape("point", { x: 100, y: 120 });
  const lines = [horizontal, vertical, diagonal, parallel];
  board.shapes.push(horizontal, vertical, diagonal, parallel, existing);
  const result = constructSelection(board, lines, "intersection");
  assert.equal(result.created.length, 2);
  assert.equal(result.duplicates, 3);
  assert.equal(result.invalid, 1);
  assert.deepEqual(result.created[0].relation.sources, [horizontal.id, vertical.id]);
  assert.deepEqual(result.created[1].relation.sources, [diagonal.id, parallel.id]);
  const count = board.shapes.length;
  assert.equal(constructSelection(board, lines, "intersection").created.length, 0);
  assert.equal(board.shapes.length, count);
  assert.equal(parseDocument(JSON.stringify(board)).shapes.length, count);
}
test("批量求交跳过已有点、共点和无效配对", testBatchIntersections);

/** 顶边编号为零，圆角和旋转改变后仍指向同一条边 */
function testConstructionEdge(): void {
  const board = createDocument();
  const frame = createShape("rect", { x: 20, y: 30 });
  frame.width = 120;
  frame.height = 80;
  board.shapes.push(frame);
  const edges = straightOutlineEdges(frame);
  const line = lineFromOutlineEdge(frame, edges[0]);
  const sourceEdges = new Map();
  sourceEdges.set(line, 0);
  const result = constructSelection(board, [line], "midpoint", sourceEdges);
  const midpoint = result.created[0];
  assert.equal(midpoint.x, 80);
  assert.equal(midpoint.y, 30);
  frame.cornerRadius = 15;
  frame.rotation = 90;
  updateRelations(board);
  assert.equal(midpoint.x, 120);
  assert.equal(midpoint.y, 70);
  assert.deepEqual(midpoint.relation.sourceEdges, [0]);
  assert.equal(parseDocument(JSON.stringify(board)).shapes[1].x, 120);

  midpoint.relation.sourceEdges = [4];
  /** 读取边号超出实际边数的作品，确认它不会被当成有效来源 */
  function readInvalidEdge(): void {
    parseDocument(JSON.stringify(board));
  }
  assert.throws(readInvalidEdge, /构造来源不是有效直边/);
}
test("构造中点在圆角和旋转改变后保留顶边", testConstructionEdge);

/** 整选图形后，各几何工具按直边计算，不把边的延长线当作图形的一部分 */
function testWholeShapeConstruction(): void {
  const board = createDocument();
  const frame = createShape("polygon", { x: 0, y: 0 });
  frame.width = 240;
  frame.height = 80;
  frame.sides = 5;
  frame.points = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 240, y: 40 },
    { x: 160, y: 80 },
    { x: 0, y: 80 }
  ];
  const point = createShape("point", { x: 300, y: 300 });
  board.shapes.push(frame, point);
  const cases: { kind: ConstructionTool; count: number }[] = [
    { kind: "intersection", count: 5 },
    { kind: "bisector", count: 5 },
    { kind: "midpoint", count: 5 },
    { kind: "parallel", count: 5 },
    { kind: "perpendicular", count: 5 }
  ];
  for (const item of cases) {
    const selection = expandConstructionSelection([frame, point], item.kind);
    const result = constructSelection(board, selection.sources, item.kind, selection.edges);
    assert.equal(result.created.length, item.count, item.kind);
    for (const shape of result.created) {
      assert.equal(shape.relation.sources[0], frame.id);
      assert.ok(shape.relation.sourceEdges);
      assert.equal(shape.locked, true);
    }
    if (item.kind === "bisector") {
      const corner = result.created[1];
      assert.deepEqual(corner.relation.sourceEdges, [0, 4]);
      assert.ok(corner.width > 0 && corner.height > 0);
    }
  }
  const restored = parseDocument(JSON.stringify(board));
  assert.equal(updateRelations(restored).size, 0);
}
test("整选多边形可批量取中点、交点及构造线", testWholeShapeConstruction);

/** SVG 路径保留直线命令的真实端点，不跨越曲线或子路径 */
function testSvgStraightEdges(): void {
  const shape = createShape("path", { x: 100, y: 200 });
  shape.width = 80;
  shape.height = 40;
  shape.path = "M 20 30 H 60 Q 60 45 40 50 M 20 50 L 30 50";
  const edges = straightOutlineEdges(shape);
  assert.deepEqual(edges, [
    { start: { x: 100, y: 200 }, end: { x: 180, y: 200 } },
    { start: { x: 100, y: 240 }, end: { x: 120, y: 240 } }
  ]);
}
test("SVG 路径只提取实际存在的直线段", testSvgStraightEdges);

/** 曲线上的点用路径参数定位，拖动和重新载入后仍能带动后续直线 */
function testAttachedCurvePoint(): void {
  const board = createDocument();
  const view = { x: 0, y: 0, width: board.width, height: board.height };
  const curve = createShape("path", { x: 100, y: 100 });
  curve.width = 200;
  // 使用 Fabric 的原始路径外框高度，让测试曲线不额外缩放
  curve.height = 150;
  curve.path = "M 0 0 Q 100 200 200 0";
  board.shapes.push(curve);
  const point = createShape("point", { x: 200, y: 200 });
  attachNewPoint(board, point, point, 1, view, new Set<string>());
  assert.equal(point.relation.kind, "point-on-outline");
  const end = createShape("point", { x: 500, y: 200 });
  board.shapes.push(point, end);
  constructShape(board, [point, end], "segment");

  const reopened = parseDocument(JSON.stringify(board));
  const source = reopened.shapes[0];
  const attached = reopened.shapes[1];
  const line = reopened.shapes[3];
  slideAttachedPoint(reopened, attached, { x: 250, y: 240 }, view);
  assert.ok(attached.x > 200);
  const fraction = (attached.x - source.x) / source.width;
  const expectedHeight = 400 * fraction * (1 - fraction);
  assert.ok(Math.abs(attached.y - source.y - expectedHeight) < 0.000001);
  const previousX = attached.x;
  source.x = source.x + 60;
  updateRelations(reopened);
  assert.ok(Math.abs(attached.x - previousX - 60) < 0.000001);
  assert.equal(line.x, attached.x);
  assert.equal(line.y, attached.y);
}
test("曲线上的点保留路径位置并带动后续构造", testAttachedCurvePoint);

/** 不把 SVG 子路径之间的空白当成能依附的边 */
function testAttachmentSkipsPathGap(): void {
  const board = createDocument();
  const source = createShape("path", { x: 100, y: 100 });
  source.width = 200;
  source.height = 1;
  source.path = "M 0 0 L 40 0 M 160 0 L 200 0";
  board.shapes.push(source);
  const point = createShape("point", { x: 200, y: 100 });
  const view = { x: 0, y: 0, width: board.width, height: board.height };
  attachNewPoint(board, point, point, 1, view, new Set<string>());
  assert.equal(point.relation.kind, "none");
}
test("路径断开的位置仍可创建自由点", testAttachmentSkipsPathGap);

/** 每个选中点和每条选中线配对，并保持来源关系与统一的撤销记录 */
function testBatchLines(): void {
  const board = createDocument();
  const first = createShape("point", { x: 40, y: 40 });
  const second = createShape("point", { x: 80, y: 60 });
  const horizontal = createShape("line", { x: 0, y: 0 });
  horizontal.width = 100;
  const vertical = createShape("line", { x: 0, y: 0 });
  vertical.height = 100;
  board.shapes.push(first, second, horizontal, vertical);
  const selected = board.shapes.slice();
  const history = new History();
  history.reset(board);
  const methods: ConstructionTool[] = ["parallel", "perpendicular"];
  for (const kind of methods) {
    const result = constructSelection(board, selected, kind);
    assert.equal(result.created.length, 4);
    assert.deepEqual(result.created[3].relation.sources, [vertical.id, second.id]);
    history.push(board);
  }
  first.y = 60;
  updateRelations(board);
  assert.equal(board.shapes[4].y, 60);
  const undo = history.undo();
  if (undo === null) {
    throw new Error("缺少可撤销的构造记录");
  }
  assert.equal(parseDocument(undo).shapes.length, 8);
  const result = constructSelection(board, selected, "midpoint");
  assert.equal(result.created.length, 2);
}
test("批量平行线、垂线和中点保留来源", testBatchLines);

/** 一批结果放不下时不留下部分对象或标签 */
function testBatchCapacity(): void {
  const board = createDocument();
  const first = createShape("line", { x: 0, y: 0 });
  const second = createShape("line", { x: 0, y: 20 });
  first.width = 100;
  second.width = 100;
  board.shapes.push(first, second);
  while (board.shapes.length < MAX_SHAPES - 3) {
    board.shapes.push(createShape("rect", { x: 0, y: 0 }));
  }
  const before = board.shapes.slice();
  /** 尝试提交需要四个空位的两个中点和点名 */
  function createTooMany(): void {
    constructSelection(board, [first, second], "midpoint");
  }
  assert.throws(createTooMany, /对象上限/);
  assert.deepEqual(board.shapes, before);
}
test("超过容量时不提交部分批量构造", testBatchCapacity);

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
