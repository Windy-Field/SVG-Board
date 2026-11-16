import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import packageInfo from "../package.json";
import { BUILD_DIRECTORY, RELEASE_DIRECTORY } from "../config/paths";

/** 将发布目录中的文件加入压缩包，保留第三方许可和示例 */
async function addFolder(zip: JSZip, directory: string, prefix: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const target = prefix + entry.name;
    if (entry.isDirectory()) {
      await addFolder(zip, source, target + "/");
    } else {
      const content = await fs.readFile(source);
      zip.file(target, content);
    }
  }
}

/** 生成可解压后双击打开的发布包，文件名从项目版本读取 */
async function packageApplication(): Promise<void> {
  const zip = new JSZip();
  await addFolder(zip, BUILD_DIRECTORY, "");
  await addFolder(zip, "examples", "examples/");
  const editor = await fs.readFile(path.join(BUILD_DIRECTORY, "editor.html"));
  zip.file("index.html", editor);
  zip.file("LICENSE", await fs.readFile("LICENSE"));
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.mkdir(RELEASE_DIRECTORY, { recursive: true });
  const output = path.join(RELEASE_DIRECTORY, "SVG-Board-" + packageInfo.version + ".zip");
  await fs.writeFile(output, content);
  console.log(output);
}

await packageApplication();
