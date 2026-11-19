import type { FunctionDefinition } from "../core/types";
import { MAX_MATH_COORDINATE } from "./coordinates";

/** 读取有限端点，拒绝空值和超过坐标上限的数值 */
function readFiniteBound(value: unknown): number {
  let position = value;
  if (typeof value === "string" && value.trim() !== "") {
    position = Number(value);
  }
  if (
    typeof position !== "number" ||
    !Number.isFinite(position) ||
    Math.abs(position) > MAX_MATH_COORDINATE
  ) {
    throw new Error("端点须在 " + -MAX_MATH_COORDINATE + " 到 " + MAX_MATH_COORDINATE + " 之间");
  }
  return position;
}

/** 读取函数左端点，普通函数可以用 -inf */
export function readDomainMinimum(
  value: unknown,
  allowInfinite: boolean
): FunctionDefinition["minimum"] {
  if (allowInfinite && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "-inf") {
      return "-inf";
    }
  }
  return readFiniteBound(value);
}

/** 读取函数右端点，普通函数可以用 inf 或 +inf */
export function readDomainMaximum(
  value: unknown,
  allowInfinite: boolean
): FunctionDefinition["maximum"] {
  if (allowInfinite && typeof value === "string") {
    const trimmed = value.trim();
    const endpoint = trimmed.toLowerCase();
    if (endpoint === "inf" || endpoint === "+inf") {
      return "inf";
    }
  }
  return readFiniteBound(value);
}

/** 判断是否需要随视口重新计算曲线 */
export function hasOpenDomain(formula: FunctionDefinition | undefined): boolean {
  return formula !== undefined && (formula.minimum === "-inf" || formula.maximum === "inf");
}
