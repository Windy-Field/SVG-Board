import fs from "node:fs";
import path from "node:path";

// 发布包中集中保存运行时依赖的许可与署名，不改写第三方原文
const DEPENDENCY_LICENSES = "dist/licenses/dependencies";

// 发布目录必须随应用保留第三方版权与许可，不依赖开发时的 node_modules
fs.copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
fs.copyFileSync("dist/editor.html", "dist/index.html");
fs.mkdirSync("dist/licenses", { recursive: true });
fs.copyFileSync("node_modules/marked/LICENSE", "dist/licenses/marked-LICENSE");
fs.copyFileSync("node_modules/dompurify/LICENSE", "dist/licenses/dompurify-LICENSE");

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
fs.mkdirSync(DEPENDENCY_LICENSES, { recursive: true });
for (const folder of Object.keys(lock.packages)) {
  const entry = lock.packages[folder];
  if (folder === "" || entry.dev === true || !fs.existsSync(folder)) {
    continue;
  }
  for (const filename of fs.readdirSync(folder)) {
    if (!/^(licen[cs]e|notice|copying)(\.|$)/i.test(filename)) {
      continue;
    }
    const source = path.join(folder, filename);
    if (!fs.statSync(source).isFile()) {
      continue;
    }
    const name = folder.replaceAll("/", "__") + "__" + filename;
    fs.copyFileSync(source, path.join(DEPENDENCY_LICENSES, name));
  }
}
