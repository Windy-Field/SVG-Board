import fs from "node:fs";

// 发布目录必须随应用保留第三方版权与许可，不依赖开发时的 node_modules
fs.copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
fs.copyFileSync("dist/editor.html", "dist/index.html");
fs.mkdirSync("dist/licenses", { recursive: true });
fs.copyFileSync("node_modules/marked/LICENSE", "dist/licenses/marked-LICENSE");
fs.copyFileSync("node_modules/dompurify/LICENSE", "dist/licenses/dompurify-LICENSE");
