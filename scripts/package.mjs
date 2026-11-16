import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

// 本地发布压缩包的输出目录
const OUTPUT_DIRECTORY = "release";

/** 将发布目录中的文件加入压缩包，保留第三方许可和示例 */
async function addFolder(zip, directory, prefix) {
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
async function packageApplication() {
  const packageText = await fs.readFile("package.json", "utf8");
  const packageInfo = JSON.parse(packageText);
  const zip = new JSZip();
  await addFolder(zip, "dist", "");
  await addFolder(zip, "examples", "examples/");
  zip.file("index.html", await fs.readFile("dist/editor.html"));
  zip.file("LICENSE", await fs.readFile("LICENSE"));
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const output = path.join(OUTPUT_DIRECTORY, "SVG-Board-" + packageInfo.version + ".zip");
  await fs.writeFile(output, content);
  console.log(output);
}

await packageApplication();
