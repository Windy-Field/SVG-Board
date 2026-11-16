import { parse } from "mathjs";
import type { EvalFunction, MathNode } from "mathjs";

// 解析式最多允许的字符数，限制输入与解析工作量
export const MAX_EXPRESSION_LENGTH = 500;
// 单个解析式允许的最多语法节点数
const MAX_EXPRESSION_NODES = 200;
// 缓存最近编译的表达式数量，避免长期使用时无限增长
const MAX_COMPILED_EXPRESSIONS = 64;
// 函数绘制接受的数学函数，不开放文件、赋值或对象访问
const FUNCTIONS = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sqrt",
  "abs",
  "exp",
  "log",
  "log10",
  "floor",
  "ceil",
  "round"
];
// 解析式允许的普通算术运算
const OPERATORS = ["+", "-", "*", "/", "^", "%"];
const compiledExpressions = new Map<string, EvalFunction>();

/** 校验解析树后编译，禁止赋值、脚本、数组和任意属性访问 */
export function compileExpression(expression: string): EvalFunction {
  let text = expression.trim();
  text = text.replace(/^y\s*=/i, "");
  if (text.length === 0 || text.length > MAX_EXPRESSION_LENGTH) {
    throw new Error("请输入不超过 500 字的函数解析式");
  }
  const cached = compiledExpressions.get(text);
  if (cached !== undefined) {
    return cached;
  }
  let root: MathNode;
  try {
    root = parse(text);
  } catch {
    throw new Error("解析式有误，请检查括号和运算符");
  }
  let count = 0;
  /** 只接受单变量实函数需要的语法节点 */
  function validate(node: MathNode): void {
    count = count + 1;
    if (count > MAX_EXPRESSION_NODES) {
      throw new Error("解析式过于复杂");
    }
    if (node.type === "SymbolNode" && "name" in node && typeof node.name === "string") {
      if (
        node.name !== "x" &&
        node.name !== "pi" &&
        node.name !== "e" &&
        !FUNCTIONS.includes(node.name)
      ) {
        throw new Error("解析式只支持变量 x 和常用数学函数");
      }
    } else if (node.type === "OperatorNode" && "op" in node && typeof node.op === "string") {
      if (!OPERATORS.includes(node.op)) {
        throw new Error("解析式包含不支持的运算");
      }
    } else if (node.type === "ConstantNode" && "value" in node) {
      if (typeof node.value !== "number") {
        throw new Error("解析式中的常量必须是数值");
      }
    } else if (node.type !== "ParenthesisNode" && node.type !== "FunctionNode") {
      throw new Error("请输入只包含数值、变量 x 和数学运算的解析式");
    }
  }
  root.traverse(validate);
  const compiled = root.compile();
  if (compiledExpressions.size >= MAX_COMPILED_EXPRESSIONS) {
    compiledExpressions.clear();
  }
  compiledExpressions.set(text, compiled);
  return compiled;
}

/** 求实数函数值，定义域外和无穷值返回 null，让曲线在此断开 */
export function evaluateExpression(compiled: EvalFunction, position: number): number | null {
  try {
    const value: unknown = compiled.evaluate({ x: position });
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}
