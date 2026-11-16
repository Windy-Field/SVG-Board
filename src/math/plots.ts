import { PolynomialRegression } from "ml-regression-polynomial";
import { format } from "mathjs";
import { compileExpression, evaluateExpression } from "./expressions";
import {
  toCanvasPoint,
  toMathPoint,
  MAX_COORDINATE_POINTS,
  MAX_MATH_COORDINATE
} from "./coordinates";
import { createShape, MAX_COORDINATE, MAX_NAME_LENGTH } from "../core/model";
import type { FunctionDefinition, Point, Shape } from "../core/types";

// 默认函数绘制范围，单位为数学坐标
export const DEFAULT_DOMAIN_MINIMUM = -10;
export const DEFAULT_DOMAIN_MAXIMUM = 10;
// 多项式拟合允许的最高阶数，至少为一阶
export const MAX_FIT_DEGREE = 8;
// 拟合至少为一阶，单变量线性拟合与界面下限共用
export const MIN_FIT_DEGREE = 1;
// 单条函数曲线的采样段数
const SAMPLE_COUNT = 1000;
// 相邻采样点超过此距离时断开路径，避免跨越渐近线
const MAX_SAMPLE_JUMP = 800;
// 函数取值范围保留在文件尺寸上限内，单位为画布坐标
const MAX_PLOT_POSITION = MAX_COORDINATE / 2;
// 曲线旁显示系数的有效数字，不改变计算和保存使用的精度
const LABEL_PRECISION = 6;
// 省略拟合中的微小舍入误差，相对于最大系数
const LABEL_ZERO_RATIO = 0.00000001;
// 曲线说明优先靠近的数学横坐标
const LABEL_POSITION_X = 1;

/** 生成人能直接阅读的解析式，计算仍使用未舍入的原始系数 */
export function getFunctionLabel(shape: Shape): string {
  const formula = shape.formula;
  if (formula === undefined) {
    return shape.text;
  }
  if (formula.coefficients.length === 0) {
    const expression = formula.expression.trim();
    const body = expression.replace(/^y\s*=/i, "");
    return "y = " + body.trim();
  }
  let maximum = 0;
  for (const coefficient of formula.coefficients) {
    maximum = Math.max(maximum, Math.abs(coefficient));
  }
  let expression = "";
  for (let power = formula.coefficients.length - 1; power >= 0; power = power - 1) {
    const coefficient = formula.coefficients[power];
    if (Math.abs(coefficient) <= maximum * LABEL_ZERO_RATIO) {
      continue;
    }
    let term = format(Math.abs(coefficient), { precision: LABEL_PRECISION });
    if (power > 0) {
      if (term === "1") {
        term = "";
      }
      term = term + "x";
      if (power > 1) {
        term = term + "^" + power;
      }
    }
    let sign = " + ";
    if (coefficient < 0) {
      sign = " - ";
    }
    if (expression === "") {
      sign = "";
      if (coefficient < 0) {
        sign = "-";
      }
    }
    expression = expression + sign + term;
  }
  if (expression === "") {
    expression = "0";
  }
  return "y = " + expression;
}

/** 说明文字靠近曲线上的一个有效点，平移缩放不会改变锚点 */
export function functionLabelAnchor(shape: Shape): Point {
  const formula = shape.formula;
  if (formula !== undefined) {
    const compiled = compileExpression(formula.expression);
    const preferred = Math.max(formula.minimum, Math.min(formula.maximum, LABEL_POSITION_X));
    const positions = [
      preferred,
      (formula.minimum + formula.maximum) / 2,
      formula.minimum,
      formula.maximum
    ];
    for (const horizontal of positions) {
      const vertical = evaluateExpression(compiled, horizontal);
      if (vertical !== null) {
        const point = toCanvasPoint({ x: horizontal, y: vertical });
        if (Math.abs(point.y) <= MAX_PLOT_POSITION) {
          return point;
        }
      }
    }
  }
  return { x: shape.x, y: shape.y };
}

/** 将多项式系数转换为 mathjs 可读的解析式 */
function polynomialExpression(coefficients: number[]): string {
  const terms: string[] = [];
  for (let power = 0; power < coefficients.length; power = power + 1) {
    terms.push("(" + coefficients[power] + ")*x^" + power);
  }
  return terms.join(" + ");
}

/** 复用 ML.js 最小二乘拟合，检查点数和横坐标后返回函数定义 */
export function fitPolynomial(
  points: Point[],
  degree: number,
  minimum: number,
  maximum: number
): FunctionDefinition {
  if (
    !Number.isInteger(degree) ||
    degree < MIN_FIT_DEGREE ||
    degree > MAX_FIT_DEGREE ||
    points.length <= degree
  ) {
    throw new Error("拟合点数需大于阶数，阶数为 " + MIN_FIT_DEGREE + " 到 " + MAX_FIT_DEGREE);
  }
  if (points.length > MAX_COORDINATE_POINTS) {
    throw new Error("拟合最多使用 " + MAX_COORDINATE_POINTS + " 个点");
  }
  const horizontal: number[] = [];
  const vertical: number[] = [];
  const unique = new Set<number>();
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("拟合点必须使用有限坐标");
    }
    horizontal.push(point.x);
    vertical.push(point.y);
    unique.add(point.x);
  }
  if (unique.size <= degree) {
    throw new Error("不同横坐标的点数需大于拟合阶数");
  }
  const regression = new PolynomialRegression(horizontal, vertical, degree);
  for (const coefficient of regression.coefficients) {
    if (!Number.isFinite(coefficient)) {
      throw new Error("这些点无法得到有效的拟合函数");
    }
  }
  return {
    expression: polynomialExpression(regression.coefficients),
    minimum: minimum,
    maximum: maximum,
    degree: degree,
    coefficients: regression.coefficients.slice()
  };
}

/** 生成分段采样路径，遇到定义域外或渐近线时重新开始一段 */
export function updateFunctionPath(shape: Shape): void {
  const formula = shape.formula;
  if (
    formula === undefined ||
    !Number.isFinite(formula.minimum) ||
    !Number.isFinite(formula.maximum) ||
    Math.abs(formula.minimum) > MAX_MATH_COORDINATE ||
    Math.abs(formula.maximum) > MAX_MATH_COORDINATE ||
    formula.minimum >= formula.maximum
  ) {
    throw new Error("函数范围的起点必须小于终点");
  }
  const compiled = compileExpression(formula.expression);
  let path = "";
  let previous: Point | null = null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let index = 0; index <= SAMPLE_COUNT; index = index + 1) {
    const horizontal =
      formula.minimum + ((formula.maximum - formula.minimum) * index) / SAMPLE_COUNT;
    const vertical = evaluateExpression(compiled, horizontal);
    if (vertical === null) {
      previous = null;
      continue;
    }
    const point = toCanvasPoint({ x: horizontal, y: vertical });
    if (Math.abs(point.x) > MAX_PLOT_POSITION || Math.abs(point.y) > MAX_PLOT_POSITION) {
      previous = null;
      continue;
    }
    let command = "M";
    if (
      previous !== null &&
      Math.hypot(point.x - previous.x, point.y - previous.y) <= MAX_SAMPLE_JUMP
    ) {
      command = "L";
    }
    path = path + command + point.x + " " + point.y + " ";
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
    previous = point;
  }
  if (!Number.isFinite(left)) {
    throw new Error("该范围内没有可绘制的实数函数值");
  }
  shape.path = path.trim();
  shape.x = left;
  shape.y = top;
  shape.width = Math.max(1, right - left);
  shape.height = Math.max(1, bottom - top);
}

/** 创建普通函数对象，外观与其他图形共用属性和导出流程 */
export function createFunctionShape(formula: FunctionDefinition): Shape {
  const shape = createShape("function", { x: 0, y: 0 });
  shape.formula = formula;
  const name = "y = " + formula.expression;
  shape.name = name.slice(0, MAX_NAME_LENGTH);
  shape.fill = "none";
  shape.locked = true;
  updateFunctionPath(shape);
  return shape;
}

/** 来源点变化后重新拟合，坐标转换与直接输入的拟合点保持一致 */
export function updateFittedFunction(shape: Shape, sources: Shape[]): void {
  if (shape.formula === undefined) {
    return;
  }
  const points: Point[] = [];
  for (const source of sources) {
    points.push(toMathPoint(source));
  }
  shape.formula = fitPolynomial(
    points,
    shape.formula.degree,
    shape.formula.minimum,
    shape.formula.maximum
  );
  updateFunctionPath(shape);
}
