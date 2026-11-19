import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocument, createShape } from "../src/core/model";
import { constructShape } from "../src/core/commands";
import { snapPosition } from "../src/geometry/snapping";
import { archiveContent } from "../src/storage/archive-content";
import { createGeometryTemplate } from "../src/objects/templates";

/** 交点坐标不在网格上时仍保留准确交点，隐藏对象不参与 */
function testIntersectionPriority(): void {
  const document = createDocument();
  const horizontal = createShape("line", { x: 100, y: 137 });
  horizontal.width = 250;
  const vertical = createShape("line", { x: 213, y: 50 });
  vertical.height = 250;
  document.shapes.push(horizontal, vertical);
  assert.deepEqual(snapPosition(document, { x: 217, y: 140 }, true, 1, ""), { x: 213, y: 137 });
  vertical.hidden = true;
  assert.deepEqual(snapPosition(document, { x: 217, y: 140 }, true, 1, ""), { x: 217, y: 137 });
  assert.deepEqual(snapPosition(document, { x: 217, y: 140 }, false, 1, ""), { x: 217, y: 140 });
}

/** 线与边框交点优先于最近边框，空白区域再吸附网格 */
function testBorderPriority(): void {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 213, y: 97 });
  rectangle.width = 120;
  rectangle.height = 100;
  const line = createShape("line", { x: 100, y: 137 });
  line.width = 250;
  document.shapes.push(rectangle, line);
  assert.deepEqual(snapPosition(document, { x: 214, y: 141 }, true, 1, ""), { x: 213, y: 137 });
  assert.deepEqual(snapPosition(document, { x: 260, y: 99 }, true, 1, ""), { x: 260, y: 97 });
  assert.deepEqual(snapPosition(document, { x: 607, y: 501 }, true, 1, ""), { x: 600, y: 500 });
}

/** 拖动来源点时跳过整条依赖链，独立图形仍可作为吸附目标 */
function testDependentShapesDoNotSnap(): void {
  const document = createDocument();
  const start = createShape("point", { x: 100, y: 137 });
  const end = createShape("point", { x: 300, y: 137 });
  document.shapes.push(start, end);
  const line = constructShape(document, [start, end], "segment");
  constructShape(document, [line], "midpoint");

  const pointer = { x: 203, y: 144 };
  const free = snapPosition(document, pointer, true, 1, start.id);
  assert.deepEqual(free, { x: 200, y: 140 });

  const guide = createShape("line", { x: 100, y: 147 });
  guide.width = 200;
  document.shapes.push(guide);
  const snapped = snapPosition(document, pointer, true, 1, start.id);
  assert.deepEqual(snapped, { x: 203, y: 147 });
}

/** 随机编号不同的同一内置作品应得到相同内容标识，编辑后则不同 */
function testArchiveContent(): void {
  const first = createGeometryTemplate();
  const second = createGeometryTemplate();
  assert.equal(archiveContent(first), archiveContent(second));
  second.shapes[1].x = second.shapes[1].x + 10;
  assert.notEqual(archiveContent(first), archiveContent(second));
}

test("交点优先且不受网格取整影响", testIntersectionPriority);
test("边框交点边框与网格按顺序吸附", testBorderPriority);
test("来源点只吸附独立于自身的图形", testDependentShapesDoNotSnap);
test("存档按内容比较并保留不同编辑", testArchiveContent);
