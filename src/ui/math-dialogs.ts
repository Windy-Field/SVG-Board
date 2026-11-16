import type { BoardCanvas } from "../canvas/canvas";
import type { Point, Shape } from "../core/types";
import { createShape, MAX_SHAPES } from "../core/model";
import {
  parseCoordinatePoints,
  toCanvasPoint,
  toMathPoint,
  MAX_MATH_COORDINATE
} from "../math/coordinates";
import {
  createFunctionShape,
  fitPolynomial,
  DEFAULT_DOMAIN_MINIMUM,
  DEFAULT_DOMAIN_MAXIMUM,
  MAX_FIT_DEGREE
} from "../math/plots";
import { MAX_EXPRESSION_LENGTH } from "../math/expressions";
import { addPointLabel, nextPointName } from "../objects/point-labels";

// 批量坐标输入框允许的最大字符数
const MAX_POINTS_INPUT = 10000;
// 函数输入框首次显示的解析式
const DEFAULT_EXPRESSION = "sin(x)";
// 多项式拟合输入框的初始阶数
const DEFAULT_FIT_DEGREE = 2;
let currentMode = "";
let canvas: BoardCanvas;
let changed: () => void;
let selectedSources: Shape[] = [];

/** 创建数学输入对话框，计算成功后才一次性写入作品 */
export function setupMathDialogs(board: BoardCanvas, commit: () => void): void {
  canvas = board;
  changed = commit;
  const dialog = document.createElement("dialog");
  dialog.id = "math-dialog";
  dialog.innerHTML =
    '<form id="math-form"><div class="dialog-heading"><h2 id="math-title"></h2><button type="button" id="math-close" class="icon-button" aria-label="关闭数学工具" title="关闭"><i data-lucide="x" aria-hidden="true"></i></button></div>' +
    '<label id="math-expression-field" class="property-field"><span>y =</span><input id="math-expression" aria-label="函数解析式" maxlength="' +
    MAX_EXPRESSION_LENGTH +
    '" value="' +
    DEFAULT_EXPRESSION +
    '" /></label>' +
    '<label id="math-points-field" class="property-field"><span>坐标</span><textarea id="math-points" aria-label="坐标列表" rows="6" maxlength="' +
    MAX_POINTS_INPUT +
    '" placeholder="0, 0&#10;1, 1&#10;2, 4"></textarea></label>' +
    '<div id="math-fit-fields"><div class="fit-modes" role="group" aria-label="拟合方式"><label><input type="radio" name="fit-mode" value="linear" checked />线性拟合</label><label><input type="radio" name="fit-mode" value="polynomial" />多项式拟合</label></div><label class="property-field"><span>多项式阶数</span><input id="math-degree" aria-label="多项式阶数" type="number" min="1" max="' +
    MAX_FIT_DEGREE +
    '" value="' +
    DEFAULT_FIT_DEGREE +
    '" step="1" /></label><p id="math-source-count"></p></div>' +
    '<div id="math-domain" class="property-grid"><label class="property-field"><span>起始 x</span><input id="math-minimum" aria-label="起始 x" type="number" min="' +
    -MAX_MATH_COORDINATE +
    '" max="' +
    MAX_MATH_COORDINATE +
    '" value="' +
    DEFAULT_DOMAIN_MINIMUM +
    '" step="any" /></label><label class="property-field"><span>结束 x</span><input id="math-maximum" aria-label="结束 x" type="number" min="' +
    -MAX_MATH_COORDINATE +
    '" max="' +
    MAX_MATH_COORDINATE +
    '" value="' +
    DEFAULT_DOMAIN_MAXIMUM +
    '" step="any" /></label></div>' +
    '<p id="math-error" role="alert"></p><div class="dialog-actions"><button type="submit" class="primary-button">创建</button></div></form>';
  document.body.append(dialog);
  const form = document.getElementById("math-form");
  const close = document.getElementById("math-close");
  if (form !== null && close !== null) {
    form.addEventListener("submit", handleSubmit);
    close.addEventListener("click", closeDialog);
  }
}

/** 取得已创建的输入框，避免把缺失元素当成有效输入 */
function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("数学输入框未创建");
  }
  return element;
}

/** 打开指定数学工具，拟合优先使用当前选中的点 */
export function openMathDialog(mode: string): void {
  currentMode = mode;
  selectedSources = [];
  for (const shape of canvas.getSelectedShapes()) {
    if (shape.kind === "point") {
      selectedSources.push(shape);
    }
  }
  const dialog = document.getElementById("math-dialog");
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }
  const title = document.getElementById("math-title");
  if (title !== null) {
    title.textContent = "坐标点";
    if (mode === "function") {
      title.textContent = "函数绘制";
    } else if (mode === "fit") {
      title.textContent = "点拟合";
    }
  }
  for (const id of [
    "math-expression-field",
    "math-points-field",
    "math-fit-fields",
    "math-domain"
  ]) {
    const element = document.getElementById(id);
    if (element !== null) {
      element.hidden = false;
      if (id === "math-expression-field") {
        element.hidden = mode !== "function";
      } else if (id === "math-fit-fields") {
        element.hidden = mode !== "fit";
      } else if (id === "math-domain") {
        element.hidden = mode === "coordinate-point";
      } else {
        element.hidden = mode === "function" || (mode === "fit" && selectedSources.length >= 2);
      }
    }
  }
  const count = document.getElementById("math-source-count");
  if (count !== null) {
    count.textContent = "已选择 " + selectedSources.length + " 个点";
  }
  const error = document.getElementById("math-error");
  if (error !== null) {
    error.textContent = "";
  }
  dialog.showModal();
}

/** 关闭数学输入，不创建半成品对象 */
function closeDialog(): void {
  const dialog = document.getElementById("math-dialog");
  if (dialog instanceof HTMLDialogElement) {
    dialog.close();
  }
}

/** 将数学坐标创建为普通几何点，点的颜色和属性继续沿用现有对象 */
function createCoordinateShape(position: Point, pending: Shape[]): Shape {
  const shape = createShape("point", toCanvasPoint(position));
  shape.coordinatePoint = true;
  shape.name = nextPointName(canvas.document, pending);
  shape.text = shape.name;
  shape.stroke = canvas.stroke;
  return shape;
}

/** 从现有选区或输入坐标创建拟合结果，计算失败时不改动作品 */
function createFitShapes(text: string, minimum: number, maximum: number): Shape[] {
  const additions: Shape[] = [];
  const points: Point[] = [];
  let sources = selectedSources;
  if (sources.length < 2) {
    sources = [];
    for (const position of parseCoordinatePoints(text)) {
      const point = createCoordinateShape(position, additions);
      sources.push(point);
      additions.push(point);
      points.push(position);
    }
  } else {
    for (const source of sources) {
      points.push(toMathPoint(source));
    }
  }
  let degree = 1;
  const polynomial = document.querySelector('input[name="fit-mode"][value="polynomial"]');
  if (polynomial instanceof HTMLInputElement && polynomial.checked) {
    degree = Number(input("math-degree").value);
  }
  const shape = createFunctionShape(fitPolynomial(points, degree, minimum, maximum));
  const ids: string[] = [];
  for (const source of sources) {
    ids.push(source.id);
  }
  shape.relation = { kind: "fit", sources: ids };
  shape.name = "拟合函数";
  shape.stroke = canvas.stroke;
  additions.push(shape);
  return additions;
}

/** 根据当前数学工具读取输入，返回完整的一批新对象 */
function createMathShapes(text: string): Shape[] {
  const additions: Shape[] = [];
  if (currentMode === "coordinate-point") {
    for (const position of parseCoordinatePoints(text)) {
      additions.push(createCoordinateShape(position, additions));
    }
    return additions;
  }
  const minimum = Number(input("math-minimum").value);
  const maximum = Number(input("math-maximum").value);
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum >= maximum ||
    Math.abs(minimum) > MAX_MATH_COORDINATE ||
    Math.abs(maximum) > MAX_MATH_COORDINATE
  ) {
    throw new Error("函数范围须递增且位于 " + -MAX_MATH_COORDINATE + " 到 " + MAX_MATH_COORDINATE);
  }
  if (currentMode === "fit") {
    return createFitShapes(text, minimum, maximum);
  }
  const shape = createFunctionShape({
    expression: input("math-expression").value,
    minimum: minimum,
    maximum: maximum,
    degree: 0,
    coefficients: []
  });
  shape.stroke = canvas.stroke;
  additions.push(shape);
  return additions;
}

/** 整批对象校验成功后一起写入，创建操作只产生一条撤销记录 */
function handleSubmit(event: SubmitEvent): void {
  event.preventDefault();
  if (canvas.readOnly) {
    return;
  }
  try {
    const textarea = document.getElementById("math-points");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    const additions = createMathShapes(textarea.value);
    let labelCount = 0;
    for (const shape of additions) {
      if (shape.kind === "point") {
        labelCount = labelCount + 1;
      }
    }
    if (canvas.document.shapes.length + additions.length + labelCount > MAX_SHAPES) {
      throw new Error("对象数量已达上限");
    }
    canvas.selectedIds = [];
    for (const shape of additions) {
      shape.layer = canvas.document.shapes.length;
      canvas.document.shapes.push(shape);
      canvas.selectedIds.push(shape.id);
    }
    // 点先全部写入，再添加文字，保证拟合来源和点名的依赖顺序都有效
    for (const shape of additions) {
      addPointLabel(canvas.document, shape);
    }
    canvas.showAxes = true;
    canvas.setTool("select");
    canvas.render();
    changed();
    closeDialog();
  } catch (error) {
    const element = document.getElementById("math-error");
    if (element !== null && error instanceof Error) {
      element.textContent = error.message;
    }
  }
}
