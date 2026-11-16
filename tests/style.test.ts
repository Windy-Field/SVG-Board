import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { checkHtml, checkSource } from "../scripts/check-style";

/** 检查器应拒绝禁用语法、类型绕过和没有功能说明的函数 */
function testRejectedSyntax(): void {
  const messages: string[] = [];
  /** 收集预期报错，避免违规示例污染正常测试输出 */
  function capture(message: unknown): void {
    messages.push(String(message));
  }
  mock.method(console, "error", capture);
  try {
    const invalid = [
      "const handler = () => 1;",
      "const item = { name };",
      "let value = ready ? 1 : 2;",
      "value += 1;",
      "const { name } = item;",
      "const result = item?.name;",
      "const value: any = input;",
      "const value = input as string;",
      "const value = <string>input;",
      "function missing() {}",
      "// 普通注释也不能加句号。\nconst value = 1;",
      "/* @ts-expect-error */\nconst value = 1;"
    ];
    for (const source of invalid) {
      assert.ok(checkSource("fixture.ts", source) > 0, source);
    }
    assert.ok(messages.length >= invalid.length);
  } finally {
    mock.restoreAll();
  }
}
test("风格检查拒绝禁用写法和类型绕过", testRejectedSyntax);

/** HTML 脚本和普通源码使用同一规则，字符串中的示例不会误报 */
function testInlineAndStrings(): void {
  /** 接收此测试中预期的违规提示 */
  function capture(_message: unknown): void {
    return;
  }
  mock.method(console, "error", capture);
  try {
    const valid =
      '/** 返回给定名称 */\nfunction getName(name: string): string { return name; }\nconst text = "() => value";';
    assert.equal(checkSource("valid.ts", valid), 0);
    assert.equal(checkSource("regex.ts", "const pattern = /@ts-ignore/;"), 0);
    assert.ok(checkHtml("page.html", "<html><script>const value = () => 1;</script></html>") > 0);
    assert.equal(checkHtml("page.html", '<script src="editor.js"></script>'), 0);
  } finally {
    mock.restoreAll();
  }
}
test("内联脚本参与检查且字符串不误报", testInlineAndStrings);
