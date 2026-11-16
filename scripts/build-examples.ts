import fs from "node:fs";
import { createFlowTemplate, createGeometryTemplate } from "../src/templates";
import { parseDocument } from "../src/document";
import type { BoardDocument } from "../src/types";

// 两份参考作品的输出目录
const OUTPUT_FOLDER = new URL("../examples/", import.meta.url);

/** 从同一份模板生成可直接打开的参考存档，写入前检查文件格式 */
function writeExample(filename: string, document: BoardDocument): void {
  const text = JSON.stringify(document, null, 2);
  parseDocument(text);
  fs.writeFileSync(new URL(filename, OUTPUT_FOLDER), text + "\n", "utf8");
}

fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
writeExample("course-flow.svgboard.json", createFlowTemplate());
writeExample("triangle-median.svgboard.json", createGeometryTemplate());
