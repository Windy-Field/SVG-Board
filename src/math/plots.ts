import { PolynomialRegression } from "ml-regression-polynomial";
import { compileExpression, evaluateExpression } from "./expressions";
import { toCanvasPoint, toMathPoint, MAX_COORDINATE_POINTS } from "./coordinates";
import { createShape, MAX_COORDINATE, MAX_NAME_LENGTH } from "../core/model";
import type { FunctionDefinition, Point, Shape } from "../core/types";

// 默认函数绘制范围，单位为数学坐标
export const DEFAULT_DOMAIN_MINIMUM = -10;
export const DEFAULT_DOMAIN_MAXIMUM = 10;
// 多项式拟合允许的最高阶数，至少为一阶
export const MAX_FIT_DEGREE = 8;
// 单条函数曲线的采样段数
const SAMPLE_COUNT = 1000;
// 相邻采样点超过此距离时断开路径，避免跨越渐近线
const MAX_SAMPLE_JUMP = 800;
// 函数取值范围保留在文件尺寸上限内，单位为画布坐标
const MAX_PLOT_POSITION = MAX_COORDINATE / 2;

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
    degree < 1 ||
    degree > MAX_FIT_DEGREE ||
    points.length <= degree
  ) {
    throw new Error("拟合点数需大于阶数，阶数为 1 到 8");
  }
  if (points.length > MAX_COORDINATE_POINTS) {
    throw new Error("拟合最多使用 " + MAX_COORDINATE_POINTS + " 个点");
  }
  const horizontal: number[] = [];
  const vertical: number[] = [];
  const unique = new Set<number>();
  for (const point of points) {
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
  if (formula === undefined || formula.minimum >= formula.maximum) {
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
  shape.name = ("y = " + formula.expression).slice(0, MAX_NAME_LENGTH);
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
