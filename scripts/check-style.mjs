import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCES = ["src", "scripts", "tests"];
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);
let failures = 0;

/** 收集正式代码文件，跳过构建结果与第三方依赖 */
function collectFiles(folder) {
  const files = [];
  if (!fs.existsSync(folder)) {
    return files;
  }
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const name = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const children = collectFiles(name);
      for (const child of children) {
        files.push(child);
      }
    } else if (/\.(ts|js|mjs)$/.test(name)) {
      files.push(name);
    }
  }
  return files;
}

/** 记录违规节点的位置，返回非零退出码供构建或提交前检查使用 */
function report(source, node, message) {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  console.error(source.fileName + ":" + (location.line + 1) + " " + message);
  failures = failures + 1;
}

/** 检查函数上方是否有中文功能说明，不接受只有英文或代码复述的空注释 */
function checkComment(source, node) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart());
  let found = false;
  if (ranges !== undefined) {
    for (const range of ranges) {
      const text = source.text.slice(range.pos, range.end);
      if (/[\u4e00-\u9fff]/.test(text)) {
        found = true;
      }
    }
  }
  if (!found) {
    report(source, node, "函数或类缺少中文功能说明");
  }
}

/** 遍历语法树检查明确禁止的写法，字符串里的符号不会被误判 */
function checkNode(source, node) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    report(source, node, "不允许箭头函数或函数表达式，请使用命名函数");
  }
  if (ts.isConditionalExpression(node) || ts.isShorthandPropertyAssignment(node)) {
    report(source, node, "不允许三目运算符或对象属性简写");
  }
  if (
    ts.isSpreadElement(node) ||
    ts.isSpreadAssignment(node) ||
    ts.isObjectBindingPattern(node) ||
    ts.isArrayBindingPattern(node)
  ) {
    report(source, node, "不允许展开或解构写法");
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (
      ASSIGNMENT_OPERATORS.has(operator) ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.CommaToken
    ) {
      report(source, node, "不允许复合赋值、空值合并或逗号复合逻辑");
    }
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    if (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      report(source, node, "不允许自增或自减");
    }
  }
  if (
    node.kind === ts.SyntaxKind.AnyKeyword ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    report(source, node, "不允许用 any、类型断言或非空断言绕过检查");
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    checkComment(source, node);
  }
  /** 递归检查子节点，显式命名回调便于定位检查过程 */
  function visitChild(child) {
    checkNode(source, child);
  }
  ts.forEachChild(node, visitChild);
}

for (const folder of SOURCES) {
  for (const file of collectFiles(path.join(ROOT, folder))) {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    checkNode(source, source);
    if (/^\s*\/\/\s*@ts-(ignore|nocheck)/m.test(text)) {
      console.error(file + " 不允许忽略类型检查");
      failures = failures + 1;
    }
  }
}
if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("代码风格检查通过");
}
