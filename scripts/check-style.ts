import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { pathToFileURL } from "node:url";

// 检查命令从项目根目录运行
const ROOT = process.cwd();
// 需要遍历的正式代码目录
const SOURCES = ["src", "scripts", "tests", "config"];
// 需要额外检查内联脚本的根目录 HTML 入口
const HTML_FILES = ["index.html", "editor.html"];
// 所有被禁用的复合赋值符号
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
function collectFiles(folder: string): string[] {
  const files: string[] = [];
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
    } else if (/\.(ts|js|mjs|css)$/.test(name)) {
      files.push(name);
    }
  }
  return files;
}

/** 记录违规节点的位置，返回非零退出码供构建或提交前检查使用 */
function report(source: ts.SourceFile, node: ts.Node, message: string): void {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  console.error(source.fileName + ":" + (location.line + 1) + " " + message);
  failures = failures + 1;
}

/** 检查函数上方是否有中文功能说明，不接受只有英文或代码复述的空注释 */
function checkComment(source: ts.SourceFile, node: ts.Node): void {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart());
  let found = false;
  if (ranges !== undefined) {
    for (const range of ranges) {
      const text = source.text.slice(range.pos, range.end);
      if (/[\u4e00-\u9fff]/.test(text)) {
        found = true;
      }
      if (/[。.]\s*(\*\/)?$/.test(text)) {
        report(source, node, "函数说明末尾不能有句号");
      }
    }
  }
  if (!found) {
    report(source, node, "函数或类缺少中文功能说明");
  }
}

/** 遍历语法树检查明确禁止的写法，字符串里的符号不会被误判 */
function checkNode(source: ts.SourceFile, node: ts.Node): void {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    report(source, node, "不允许箭头函数或函数表达式，请使用命名函数");
  }
  if (ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node) || ts.isCallChain(node)) {
    report(source, node, "不允许可选链，请先检查对象是否存在");
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
    ts.isTypeAssertionExpression(node) ||
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
  function visitChild(child: ts.Node): void {
    checkNode(source, child);
  }
  ts.forEachChild(node, visitChild);
}

/** 用 TypeScript 扫描器检查所有普通注释，不把字符串内容误当注释 */
function checkAllComments(source: ts.SourceFile): void {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source.text
  );
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const text = scanner.getTokenText();
      if (/[。.]\s*(\*\/)?$/.test(text)) {
        const location = source.getLineAndCharacterOfPosition(scanner.getTokenPos());
        console.error(source.fileName + ":" + (location.line + 1) + " 注释末尾不能有句号");
        failures = failures + 1;
      }
      if (/@ts-(ignore|nocheck|expect-error)\b/.test(text)) {
        console.error(source.fileName + " 不允许忽略类型检查");
        failures = failures + 1;
      }
    }
    kind = scanner.scan();
  }
}

/** 检查一份脚本源码，测试也可传入代码片段验证规则 */
export function checkSource(file: string, text: string): number {
  const before = failures;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  checkNode(source, source);
  checkAllComments(source);
  return failures - before;
}

/** 检查整份 HTML 中的内联脚本，页面结构由 parse5 解析 */
export function checkHtml(file: string, html: string): number {
  const before = failures;
  const document = parse(html, { sourceCodeLocationInfo: true });
  checkHtmlNode(file, html, document);
  return failures - before;
}

/** 使用 HTML 解析器提取内联脚本，保留原行号以便定位问题 */
function checkHtmlNode(file: string, html: string, node: DefaultTreeAdapterTypes.Node): void {
  if ("tagName" in node && node.tagName === "script") {
    const location = node.sourceCodeLocation;
    if (
      location !== undefined &&
      location !== null &&
      location.startTag !== undefined &&
      location.endTag !== undefined
    ) {
      const start = location.startTag.endOffset;
      const end = location.endTag.startOffset;
      const prefix = html.slice(0, start).replace(/[^\n]/g, " ");
      checkSource(file, prefix + html.slice(start, end));
    }
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      checkHtmlNode(file, html, child);
    }
  }
}

/** 检查项目全部正式代码和 HTML 启动脚本，生成目录不参与 */
function checkProject(): void {
  for (const folder of SOURCES) {
    for (const file of collectFiles(path.join(ROOT, folder))) {
      const text = fs.readFileSync(file, "utf8");
      if (file.endsWith(".css")) {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        checkAllComments(source);
      } else {
        checkSource(file, text);
      }
    }
  }
  for (const filename of HTML_FILES) {
    const file = path.join(ROOT, filename);
    const html = fs.readFileSync(file, "utf8");
    checkHtml(file, html);
  }
  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log("代码风格检查通过");
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  checkProject();
}
