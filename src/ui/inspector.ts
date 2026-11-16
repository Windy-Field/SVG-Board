import {
  findShape,
  isDependent,
  isLine,
  moveShape,
  resizeShape,
  SHAPE_LABELS,
  MAX_COORDINATE,
  MIN_BOARD_SIZE,
  MAX_BOARD_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE
} from "../core/model";
import { commandButton, getElement, refreshIcons } from "./ui";
import type { BoardDocument, Shape } from "../core/types";
import { fontOptions } from "./fonts";
import { MAX_CORNER_RADIUS, MAX_POINT_RADIUS } from "../core/model";
import { MAX_NAME_LENGTH, MAX_ROTATION, MAX_STROKE_WIDTH } from "../core/model";
import {
  isConstructionLine,
  setConstructionLength,
  MIN_CONSTRUCTION_LENGTH,
  MAX_CONSTRUCTION_LENGTH
} from "../geometry/geometry";
import { toMathPoint, toCanvasPoint, MAX_MATH_COORDINATE } from "../math/coordinates";
import { updateFunctionPath } from "../math/plots";
import { MAX_EXPRESSION_LENGTH } from "../math/expressions";

/** 校验属性控件并更新作品，返回是否需要提交修改 */
export function applyProperty(
  document: BoardDocument,
  selected: Shape[],
  control: HTMLInputElement | HTMLSelectElement
): boolean {
  const property = control.dataset.property;
  if (property === undefined) {
    return false;
  }
  if (control instanceof HTMLInputElement && !control.checkValidity()) {
    control.reportValidity();
    return false;
  }
  const value = Number(control.value);
  if (property === "background") {
    if (!/^#[0-9a-f]{6}$/i.test(control.value)) {
      return false;
    }
    document.background = control.value;
    return true;
  }
  if (property === "boardWidth" || property === "boardHeight") {
    if (!Number.isFinite(value) || value < MIN_BOARD_SIZE || value > MAX_BOARD_SIZE) {
      return false;
    }
    if (property === "boardWidth") {
      document.width = value;
    } else {
      document.height = value;
    }
    return true;
  }
  let target = selected;
  if (control.dataset.object !== undefined) {
    const shape = findShape(document, control.dataset.object);
    if (shape === undefined) {
      return false;
    }
    target = [shape];
  }
  if (target.length !== 1) {
    if (property === "opacity" && Number.isFinite(value) && value >= 0 && value <= 1) {
      for (const shape of target) {
        shape.opacity = value;
      }
      return target.length > 0;
    }
    return false;
  }
  const shape = target[0];
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return applyCheckbox(shape, property, control.checked);
  }
  if (control instanceof HTMLInputElement && control.type === "number") {
    return applyNumber(shape, property, value);
  }
  if (property === "expression" && shape.formula !== undefined) {
    const copy = structuredClone(shape);
    if (copy.formula === undefined) {
      return false;
    }
    copy.formula.expression = control.value;
    copy.formula.coefficients = [];
    copy.formula.degree = 0;
    updateFunctionPath(copy);
    copy.relation = { kind: "none", sources: [] };
    Object.assign(shape, copy);
  } else if (property === "name") {
    shape.name = control.value;
  } else if (property === "stroke") {
    shape.stroke = control.value;
  } else if (property === "fill") {
    shape.fill = control.value;
  } else if (property === "fontFamily") {
    shape.fontFamily = control.value;
  } else if (property === "textAlign") {
    shape.textAlign = control.value;
  } else {
    return false;
  }
  return true;
}

/** 更新数值属性，变形字段必须先检查锁定状态和构造约束 */
function applyNumber(shape: Shape, property: string, value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  if (property === "displayLength") {
    return setConstructionLength(shape, value);
  }
  if (
    (property === "domainMinimum" || property === "domainMaximum") &&
    shape.formula !== undefined
  ) {
    if (Math.abs(value) > MAX_MATH_COORDINATE) {
      return false;
    }
    const copy = structuredClone(shape);
    if (copy.formula === undefined) {
      return false;
    }
    if (property === "domainMinimum") {
      copy.formula.minimum = value;
    } else {
      copy.formula.maximum = value;
    }
    updateFunctionPath(copy);
    Object.assign(shape, copy);
    return true;
  }
  if ((property === "coordinateX" || property === "coordinateY") && !shape.locked) {
    if (Math.abs(value) > MAX_MATH_COORDINATE) {
      return false;
    }
    const position = toMathPoint(shape);
    if (property === "coordinateX") {
      position.x = value;
    } else {
      position.y = value;
    }
    const canvas = toCanvasPoint(position);
    moveShape(shape, canvas.x - shape.x, canvas.y - shape.y);
    shape.relation = { kind: "none", sources: [] };
    return true;
  }
  const fixed = shape.locked || shape.kind === "function";
  if (
    !fixed &&
    isDependent(shape) &&
    ["x", "y", "width", "height", "rotation"].includes(property)
  ) {
    shape.relation = { kind: "none", sources: [] };
  }
  if (property === "x" && !fixed) {
    moveShape(shape, value - shape.x, 0);
  } else if (property === "y" && !fixed) {
    moveShape(shape, 0, value - shape.y);
  } else if ((property === "width" || property === "height") && !fixed) {
    if (!isLine(shape) && value <= 0) {
      throw new Error("图形尺寸必须大于零");
    }
    if (property === "width") {
      resizeShape(shape, value, shape.height);
    } else {
      resizeShape(shape, shape.width, value);
    }
  } else if (property === "rotation" && !fixed) {
    shape.rotation = value;
  } else if (property === "opacity") {
    shape.opacity = value;
  } else if (property === "strokeWidth") {
    shape.strokeWidth = value;
  } else if (property === "fontSize") {
    shape.fontSize = value;
  } else if (property === "cornerRadius" && shape.kind === "rect") {
    shape.cornerRadius = value;
  } else if (property === "pointRadius" && shape.kind === "point") {
    shape.pointRadius = value;
  } else {
    return false;
  }
  return true;
}

/** 更新二元状态，无填充使用模型中的 none 表示 */
function applyCheckbox(shape: Shape, property: string, checked: boolean): boolean {
  if (property === "dash") {
    shape.dash = checked;
  } else if (property === "auxiliary") {
    shape.auxiliary = checked;
  } else if (property === "noFill") {
    shape.fill = "#ffffff";
    if (checked) {
      shape.fill = "none";
    }
  } else {
    return false;
  }
  return true;
}

/** 将用户文字用于 HTML 属性前转义，避免作品内容变成页面结构 */
function escapeHtml(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  const escapedQuotes = span.innerHTML.replace(/"/g, "&quot;");
  return escapedQuotes.replace(/'/g, "&#39;");
}

/** 生成数值属性输入，参数明确列出合法范围 */
function numberField(
  label: string,
  property: string,
  value: number,
  minimum: number,
  maximum: number,
  disabled: boolean
): string {
  let state = "";
  if (disabled) {
    state = " disabled";
  }
  return (
    '<label class="property-field"><span>' +
    label +
    '</span><input type="number" data-property="' +
    property +
    '" aria-label="' +
    label +
    '" value="' +
    Math.round(value * 100) / 100 +
    '" min="' +
    minimum +
    '" max="' +
    maximum +
    '" step="any"' +
    state +
    " /></label>"
  );
}

/** 生成对象状态复选框，保持原生键盘与屏幕阅读器行为 */
function checkboxField(label: string, property: string, checked: boolean): string {
  let state = "";
  if (checked) {
    state = " checked";
  }
  return (
    '<label class="checkbox-field"><input type="checkbox" data-property="' +
    property +
    '"' +
    state +
    " />" +
    label +
    "</label>"
  );
}

/** 生成一个颜色属性，透明值使用独立复选框表示 */
function colorField(label: string, property: string, value: string): string {
  let color = value;
  if (value === "none") {
    color = "#ffffff";
  }
  return (
    '<label class="color-field"><span>' +
    label +
    '</span><input type="color" data-property="' +
    property +
    '" aria-label="' +
    label +
    '" value="' +
    color +
    '" /><span class="color-code">' +
    value.toUpperCase() +
    "</span></label>"
  );
}

/** 无选区时显示画板尺寸和背景 */
function renderBoardProperties(document: BoardDocument): string {
  return (
    '<section class="property-section"><div class="section-title"><h2>画板</h2><span>01</span></div><div class="property-grid">' +
    numberField("画板宽度", "boardWidth", document.width, MIN_BOARD_SIZE, MAX_BOARD_SIZE, false) +
    numberField("画板高度", "boardHeight", document.height, MIN_BOARD_SIZE, MAX_BOARD_SIZE, false) +
    "</div>" +
    colorField("画布颜色", "background", document.background) +
    "</section>"
  );
}

/** 用真实对象信息生成属性面板，几何约束对象禁用自由变形 */
export function renderProperties(document: BoardDocument, selected: Shape[]): void {
  const panel = getElement("properties-panel");
  if (selected.length === 0) {
    panel.innerHTML = renderBoardProperties(document);
    return;
  }
  if (selected.length > 1) {
    panel.innerHTML =
      '<section class="property-section"><h2>已选择 ' +
      selected.length +
      " 个对象</h2>" +
      numberField("透明度", "opacity", selected[0].opacity, 0, 1, false) +
      '<div class="multi-actions"><button type="button" data-action="group">组合</button><button type="button" data-action="ungroup">取消组合</button><button type="button" data-action="align-left">左对齐</button><button type="button" data-action="align-top">顶对齐</button><button type="button" data-action="distribute">水平等距</button><button type="button" data-action="same-width">统一宽度</button></div></section>';
    return;
  }
  const shape = selected[0];
  const fixed = shape.locked || shape.kind === "function";
  const point = shape.kind === "point";
  let markup =
    '<section class="property-section"><div class="section-title"><h2>' +
    SHAPE_LABELS[shape.kind] +
    "</h2><span>" +
    commandButton("delete", "删除对象", "trash-2") +
    "</span></div>";
  markup =
    markup +
    '<label class="property-field"><span>对象名称</span><input data-property="name" aria-label="对象名称" maxlength="' +
    MAX_NAME_LENGTH +
    '" value="' +
    escapeHtml(shape.name) +
    '" /></label><div class="property-grid">';
  markup = markup + numberField("X", "x", shape.x, -MAX_COORDINATE, MAX_COORDINATE, fixed);
  markup = markup + numberField("Y", "y", shape.y, -MAX_COORDINATE, MAX_COORDINATE, fixed);
  if (shape.coordinatePoint) {
    const position = toMathPoint(shape);
    markup =
      markup +
      numberField(
        "坐标 x",
        "coordinateX",
        position.x,
        -MAX_MATH_COORDINATE,
        MAX_MATH_COORDINATE,
        fixed
      ) +
      numberField(
        "坐标 y",
        "coordinateY",
        position.y,
        -MAX_MATH_COORDINATE,
        MAX_MATH_COORDINATE,
        fixed
      );
  }
  markup =
    markup +
    numberField("宽度", "width", shape.width, -MAX_COORDINATE, MAX_COORDINATE, fixed || point);
  markup =
    markup +
    numberField("高度", "height", shape.height, -MAX_COORDINATE, MAX_COORDINATE, fixed || point);
  markup =
    markup +
    numberField(
      "旋转角度",
      "rotation",
      shape.rotation,
      -MAX_ROTATION,
      MAX_ROTATION,
      fixed || point
    );
  if (isConstructionLine(shape)) {
    markup =
      markup +
      numberField(
        "显示长度",
        "displayLength",
        Math.hypot(shape.width, shape.height),
        MIN_CONSTRUCTION_LENGTH,
        MAX_CONSTRUCTION_LENGTH,
        false
      );
  }
  markup = markup + numberField("透明度", "opacity", shape.opacity, 0, 1, false);
  markup = markup + '</div></section><section class="property-section"><h2>外观</h2>';
  markup = markup + colorField("描边 / 文字", "stroke", shape.stroke);
  if (shape.kind === "rect") {
    markup =
      markup +
      numberField("圆角", "cornerRadius", shape.cornerRadius, 0, MAX_CORNER_RADIUS, shape.locked);
  }
  if (shape.kind === "point") {
    markup =
      markup +
      numberField("点半径", "pointRadius", shape.pointRadius, 1, MAX_POINT_RADIUS, shape.locked);
  }
  if (
    !isLine(shape) &&
    shape.kind !== "pencil" &&
    shape.kind !== "text" &&
    shape.kind !== "function"
  ) {
    markup = markup + colorField("填充", "fill", shape.fill);
    markup = markup + checkboxField("无填充", "noFill", shape.fill === "none");
  }
  markup =
    markup +
    '<div class="property-grid">' +
    numberField("线宽", "strokeWidth", shape.strokeWidth, 0, MAX_STROKE_WIDTH, false) +
    numberField("字号", "fontSize", shape.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, false) +
    "</div>";
  markup =
    markup +
    '<div class="checkbox-row">' +
    checkboxField("虚线", "dash", shape.dash) +
    checkboxField("辅助对象", "auxiliary", shape.auxiliary) +
    "</div></section>";
  if (shape.formula !== undefined) {
    markup =
      markup +
      '<section class="property-section"><h2>函数</h2><label class="property-field"><span>y =</span><input class="function-expression" data-property="expression" aria-label="函数解析式" maxlength="' +
      MAX_EXPRESSION_LENGTH +
      '" value="' +
      escapeHtml(shape.formula.expression) +
      '" /></label><div class="property-grid">' +
      numberField(
        "起始 x",
        "domainMinimum",
        shape.formula.minimum,
        -MAX_MATH_COORDINATE,
        MAX_MATH_COORDINATE,
        false
      ) +
      numberField(
        "结束 x",
        "domainMaximum",
        shape.formula.maximum,
        -MAX_MATH_COORDINATE,
        MAX_MATH_COORDINATE,
        false
      ) +
      "</div></section>";
  }
  if (shape.kind !== "text") {
    markup =
      markup +
      '<section class="property-section"><div class="section-title"><h2>文字</h2><button type="button" class="text-button" data-action="edit-text">编辑</button></div><label class="property-field"><span>字体</span><select data-property="fontFamily" aria-label="字体">' +
      fontOptions() +
      '</select></label><label class="property-field"><span>对齐</span><select data-property="textAlign" aria-label="文字对齐"><option value="start">左对齐</option><option value="middle">居中</option><option value="end">右对齐</option></select></label></section>';
  }
  if (isDependent(shape)) {
    const names: string[] = [];
    for (const id of shape.relation.sources) {
      const source = findShape(document, id);
      if (source !== undefined) {
        names.push(source.name);
      }
    }
    markup =
      markup +
      '<section class="property-section relationship"><h2>构造关系</h2><p>' +
      escapeHtml(shape.relation.kind) +
      "</p><p>" +
      escapeHtml(names.join("、")) +
      "</p></section>";
  }
  panel.innerHTML = markup;
  for (const control of panel.querySelectorAll("[data-property]")) {
    if (control instanceof HTMLElement) {
      control.dataset.object = shape.id;
    }
  }
  const font = panel.querySelector('[data-property="fontFamily"]');
  const align = panel.querySelector('[data-property="textAlign"]');
  if (font instanceof HTMLSelectElement) {
    font.value = shape.fontFamily;
  }
  if (align instanceof HTMLSelectElement) {
    align.value = shape.textAlign;
  }
  refreshIcons();
}
