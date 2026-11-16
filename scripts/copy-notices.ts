import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILD_DIRECTORY } from "../config/paths";
import { isRecord } from "../src/core/validation";

// 发布包中集中保存运行时依赖的许可与署名，不改写第三方原文
const LICENSE_DIRECTORY = path.join(BUILD_DIRECTORY, "licenses");
// 依赖声明与完整许可统一放在构建目录中
const DEPENDENCY_LICENSES = path.join(LICENSE_DIRECTORY, "dependencies");

/** 将一个依赖目录中的许可和署名原文复制到发布目录 */
function copyDependencyLicense(folder: string): void {
  for (const filename of fs.readdirSync(folder)) {
    if (!/^(licen[cs]e|notice|copying)(\.|$)/i.test(filename)) {
      continue;
    }
    const source = path.join(folder, filename);
    if (!fs.statSync(source).isFile()) {
      continue;
    }
    const flattened = folder.replaceAll("/", "__");
    const name = flattened + "__" + filename;
    fs.copyFileSync(source, path.join(DEPENDENCY_LICENSES, name));
  }
}

/** 构建和开发监听共用许可复制入口，只有构建结束后才执行 */
export function copyNotices(): void {
  fs.copyFileSync(
    "docs/THIRD_PARTY_NOTICES.md",
    path.join(BUILD_DIRECTORY, "THIRD_PARTY_NOTICES.md")
  );
  fs.copyFileSync(
    path.join(BUILD_DIRECTORY, "editor.html"),
    path.join(BUILD_DIRECTORY, "index.html")
  );
  fs.mkdirSync(LICENSE_DIRECTORY, { recursive: true });
  fs.copyFileSync("node_modules/marked/LICENSE", path.join(LICENSE_DIRECTORY, "marked-LICENSE"));
  fs.copyFileSync(
    "node_modules/dompurify/LICENSE",
    path.join(LICENSE_DIRECTORY, "dompurify-LICENSE")
  );
  const lock: unknown = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error("锁文件缺少依赖列表");
  }
  fs.mkdirSync(DEPENDENCY_LICENSES, { recursive: true });
  for (const folder of Object.keys(lock.packages)) {
    const entry = lock.packages[folder];
    if (!isRecord(entry)) {
      throw new Error("锁文件中的依赖记录无效");
    }
    if (folder === "" || entry.dev === true || !fs.existsSync(folder)) {
      continue;
    }
    copyDependencyLicense(folder);
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  copyNotices();
}
