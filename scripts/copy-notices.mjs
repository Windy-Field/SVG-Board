import fs from "node:fs";

// 发布目录必须随应用保留第三方版权与许可，不依赖开发时的 node_modules
fs.copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
