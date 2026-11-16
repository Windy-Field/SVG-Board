import assert from "node:assert/strict";
import { test } from "node:test";
import { compileExpression, evaluateExpression } from "../src/math/expressions";
import { parseCoordinatePoints, toCanvasPoint, toMathPoint } from "../src/math/coordinates";
import { createFunctionShape, fitPolynomial, getFunctionLabel } from "../src/math/plots";
import { createDocument, createShape } from "../src/core/model";
import { parseDocument } from "../src/storage/document";
import { constructShape } from "../src/core/commands";
import { updateRelations } from "../src/geometry/geometry";
import { extendedLinePoints } from "../src/geometry/extended-lines";
import { snapPosition } from "../src/geometry/snapping";
import { axisStep } from "../src/canvas/axes";
import { addPointLabel, nextPointName } from "../src/objects/point-labels";

/** 数学坐标正方向、批量格式与输入范围共用同一规则 */
function testCoordinates(): void {
  const points = parseCoordinatePoints("(0, 0)\n（2，3）; -1, -2");
  assert.equal(points.length, 3);
  for (const point of points) {
    assert.deepEqual(toMathPoint(toCanvasPoint(point)), point);
  }
  /** 非有限坐标不能进入作品 */
  function invalid(): void {
    parseCoordinatePoints("Infinity, 0");
  }
  assert.throws(invalid);
}
test("批量坐标与坐标转换", testCoordinates);

/** 普通数学表达式可执行，赋值、属性、脚本和无效语法不能执行 */
function testExpressions(): void {
  assert.equal(evaluateExpression(compileExpression("y = 2x + 1"), 3), 7);
  assert.equal(evaluateExpression(compileExpression("sin(pi/2) + x^2"), 2), 5);
  assert.equal(evaluateExpression(compileExpression("sqrt(x)"), -1), null);
  for (const expression of ["x=2", "import('x')", "x.constructor", "[1,2]", "x; 2", "2+"]) {
    /** 将具体无效输入交给解析器校验 */
    function reject(): void {
      compileExpression(expression);
    }
    assert.throws(reject, expression);
  }
}
test("复用解析器并限制数学语法", testExpressions);

/** 分段函数保留断点，保存恢复时从解析式重建路径 */
function testFunctionPath(): void {
  const shape = createFunctionShape({
    expression: "1/x",
    minimum: -2,
    maximum: 2,
    degree: 0,
    coefficients: []
  });
  const starts = shape.path.match(/M/g);
  assert.ok(starts !== null && starts.length >= 2);
  shape.opacity = 0.35;
  shape.strokeWidth = 4;
  const document = createDocument();
  document.shapes.push(shape);
  const restored = parseDocument(JSON.stringify(document));
  assert.equal(restored.shapes[0].opacity, 0.35);
  assert.equal(restored.shapes[0].path, shape.path);
}
test("函数断点路径与属性保存", testFunctionPath);

/** 多项式拟合复用库的最小二乘算法，来源点移动后重新计算 */
function testFitting(): void {
  const points = [
    { x: -1, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ];
  const formula = fitPolynomial(points, 2, -3, 3);
  assert.ok(Math.abs(formula.coefficients[2] - 1) < 0.000001);
  const line = fitPolynomial(
    [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 }
    ],
    1,
    -3,
    3
  );
  assert.ok(Math.abs(line.coefficients[1] - 2) < 0.000001);
  const document = createDocument();
  const ids: string[] = [];
  for (const point of points) {
    const source = createShape("point", toCanvasPoint(point));
    document.shapes.push(source);
    ids.push(source.id);
  }
  const curve = createFunctionShape(formula);
  curve.relation = { kind: "fit", sources: ids };
  document.shapes.push(curve);
  const before = curve.path;
  document.shapes[1].y = document.shapes[1].y - 40;
  assert.equal(updateRelations(document).size, 0);
  assert.notEqual(curve.path, before);
  parseDocument(JSON.stringify(document));
}
test("线性多项式拟合与来源联动", testFitting);

/** 射线只向第二点延伸，直线双向延伸且按视口裁剪 */
function testExtendedLines(): void {
  const shape = createShape("line", { x: 100, y: 100 });
  shape.width = 100;
  shape.height = 100;
  const bounds = { x: 0, y: 0, width: 400, height: 400 };
  shape.lineType = "ray";
  assert.deepEqual(extendedLinePoints(shape, bounds), [
    { x: 100, y: 100 },
    { x: 400, y: 400 }
  ]);
  shape.lineType = "straight";
  assert.deepEqual(extendedLinePoints(shape, bounds), [
    { x: 0, y: 0 },
    { x: 400, y: 400 }
  ]);
}
test("直线射线方向与矩形裁剪", testExtendedLines);

/** 角平分线默认锁定，来源直线改变方向后仍平分夹角 */
function testBisector(): void {
  const document = createDocument();
  const horizontal = createShape("line", { x: 0, y: 0 });
  horizontal.width = 100;
  const vertical = createShape("line", { x: 0, y: 0 });
  vertical.height = 100;
  document.shapes.push(horizontal, vertical);
  const bisector = constructShape(document, [horizontal, vertical], "bisector");
  assert.equal(bisector.locked, true);
  assert.equal(bisector.lineType, "straight");
  assert.ok(Math.abs(bisector.width - bisector.height) < 0.000001);
  vertical.width = 100;
  updateRelations(document);
  assert.ok(Math.abs(Math.atan2(bisector.height, bisector.width) - Math.PI / 8) < 0.000001);
  parseDocument(JSON.stringify(document));
}
test("角平分线锁定与方向联动", testBisector);

/** 函数和图形边框优先于网格，隐藏后不参与吸附 */
function testCurveSnapping(): void {
  const document = createDocument();
  const curve = createFunctionShape({
    expression: "0.325",
    minimum: -5,
    maximum: 5,
    degree: 0,
    coefficients: []
  });
  document.shapes.push(curve);
  const cursor = toCanvasPoint({ x: 1, y: 0.4 });
  const snapped = snapPosition(document, cursor, true, 1, "");
  assert.ok(Math.abs(toMathPoint(snapped).y - 0.325) < 0.000001);
  curve.hidden = true;
  assert.equal(snapPosition(document, cursor, true, 1, "").y % 20, 0);
  const circle = createShape("ellipse", { x: 100, y: 100 });
  circle.width = 200;
  circle.height = 200;
  document.shapes.push(circle);
  const border = snapPosition(document, { x: 301, y: 200 }, true, 1, "");
  assert.ok(Math.abs(border.x - 300) < 1);
}
test("函数曲线与图形边框优先吸附", testCurveSnapping);

/** 缩放改变动态刻度，不改变数学坐标单位 */
function testScale(): void {
  assert.ok(axisStep(0.25, 800) > axisStep(2, 800));
}
test("坐标轴动态分度", testScale);

/** 字母用完后按轮次编号，隐藏点和批量候选也保留已经占用的名字 */
function testPointNames(): void {
  const document = createDocument();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let index = 0; index < 54; index = index + 1) {
    let expected = alphabet[index % alphabet.length];
    const round = Math.floor(index / alphabet.length);
    if (round > 0) {
      expected = expected + round;
    }
    assert.equal(nextPointName(document), expected);
    const point = createShape("point", { x: index, y: 0 });
    point.name = expected;
    point.hidden = true;
    document.shapes.push(point);
  }
  const pending = createShape("point", { x: 0, y: 0 });
  pending.name = "C2";
  assert.equal(nextPointName(document, [pending]), "D2");
}
test("几何点按字母和轮次分配名字", testPointNames);

/** 坐标轴和曲线交点优先，关闭坐标轴后恢复普通对象与网格吸附 */
function testAxisSnapping(): void {
  const document = createDocument();
  assert.deepEqual(snapPosition(document, { x: 604, y: 313 }, true, 1, "", true), {
    x: 600,
    y: 313
  });
  assert.deepEqual(snapPosition(document, { x: 347, y: 406 }, true, 1, "", true), {
    x: 347,
    y: 400
  });
  assert.deepEqual(snapPosition(document, { x: 604, y: 406 }, true, 1, "", true), {
    x: 600,
    y: 400
  });
  assert.deepEqual(snapPosition(document, { x: 604, y: 313 }, true, 1, "", false), {
    x: 600,
    y: 320
  });
  const curve = createFunctionShape({
    expression: "0.325",
    minimum: -5,
    maximum: 5,
    degree: 0,
    coefficients: []
  });
  document.shapes.push(curve);
  const intersection = snapPosition(document, { x: 604, y: 389 }, true, 1, "", true);
  assert.ok(Math.abs(intersection.x - 600) < 0.000001);
  assert.ok(Math.abs(intersection.y - 387) < 0.000001);
}
test("坐标轴参与优先吸附和交点计算", testAxisSnapping);

/** 拟合说明使用简洁系数，普通函数去掉重复的 y 前缀 */
function testFormulaLabels(): void {
  const shape = createFunctionShape({
    expression: "x^2 + 2x + 1",
    minimum: -5,
    maximum: 5,
    degree: 2,
    coefficients: [1.00000000001, 2.00000000001, 0.99999999999]
  });
  assert.equal(getFunctionLabel(shape), "y = x^2 + 2x + 1");
  const direct = createFunctionShape({
    expression: "y = sin(x)",
    minimum: -5,
    maximum: 5,
    degree: 0,
    coefficients: []
  });
  assert.equal(getFunctionLabel(direct), "y = sin(x)");
}
test("函数与拟合解析式显示", testFormulaLabels);

/** 旧版未生成点名的坐标点读取后补齐文字，再次读取不重复添加 */
function testLegacyCoordinateLabel(): void {
  const document = createDocument();
  const point = createShape("point", toCanvasPoint({ x: 2, y: 3 }));
  point.name = "(2, 3)";
  point.coordinatePoint = true;
  document.shapes.push(point);
  const restored = parseDocument(JSON.stringify(document));
  assert.equal(restored.shapes[0].name, "A");
  assert.equal(restored.shapes[1].text, "A");
  assert.equal(restored.shapes[1].relation.sources[0], point.id);
  assert.equal(parseDocument(JSON.stringify(restored)).shapes.length, 2);
}
test("旧坐标点补齐点名且不重复", testLegacyCoordinateLabel);

/** 拖动点时不吸附自己的点名文本，避免新位置被文字外框拉回 */
function testOwnLabelSnapping(): void {
  const document = createDocument();
  const point = createShape("point", { x: 100, y: 100 });
  point.name = "A";
  point.text = "A";
  document.shapes.push(point);
  addPointLabel(document, point);
  const snapped = snapPosition(document, { x: 109, y: 84 }, true, 1, point.id, false);
  assert.deepEqual(snapped, { x: 100, y: 80 });
}
test("拖动点不吸附自己的点名", testOwnLabelSnapping);
