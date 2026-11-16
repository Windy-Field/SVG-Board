import { build, createServer } from "vite";
import { copyNotices } from "./copy-notices";
import { VITE_CONFIG } from "../config/paths";
import type { ViteDevServer } from "vite";
import type { RollupWatcher, RollupWatcherEvent } from "rollup";
import type { IncomingMessage, ServerResponse } from "node:http";

// 开发服务默认端口，可通过 --port 指定
const DEFAULT_PORT = 5173;
let server: ViteDevServer | undefined;
let watcher: RollupWatcher | undefined;

/** 提供项目身份探测，文件入口只连接当前画板服务 */
function runtimeStatus(request: IncomingMessage, response: ServerResponse, next: () => void): void {
  if (request.url !== "/__svg_board_runtime") {
    next();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("svg-board-development");
}

/** 在页面回退路由之前注册探测接口 */
function configureRuntime(server: ViteDevServer): void {
  server.middlewares.use(runtimeStatus);
}

/** 离线文件重建后同步发布入口与许可 */
function handleBuild(event: RollupWatcherEvent): void {
  if (event.code === "END") {
    copyNotices();
  }
  if (event.code === "ERROR") {
    console.error(event.error);
  }
}

/** 关闭开发服务时一并停止离线构建监听 */
async function closeDevelopment(): Promise<void> {
  if (server !== undefined) {
    await server.close();
  }
  if (watcher !== undefined) {
    await watcher.close();
  }
}

/** 开发页面与离线入口同时更新，端口沿用 Vite 的命令行参数 */
async function startDevelopment(): Promise<void> {
  let port = DEFAULT_PORT;
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  if (portIndex >= 0) {
    const requested = Number(args[portIndex + 1]);
    if (Number.isInteger(requested) && requested > 0 && requested <= 65535) {
      port = requested;
    }
  }
  const result = await build({ configFile: VITE_CONFIG, build: { watch: {} } });
  if (!Array.isArray(result) && "on" in result) {
    watcher = result;
    watcher.on("event", handleBuild);
  }
  server = await createServer({
    configFile: VITE_CONFIG,
    plugins: [{ name: "svg-board-runtime", configureServer: configureRuntime }],
    server: { host: "127.0.0.1", port: port }
  });
  await server.listen();
  server.printUrls();
  process.on("SIGINT", closeDevelopment);
  process.on("SIGTERM", closeDevelopment);
}

await startDevelopment();
