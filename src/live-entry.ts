// 双击入口对应的固定本地开发地址
const DEVELOPMENT_URL = "http://127.0.0.1:5173";
// 离线页检测开发服务的间隔，单位为毫秒
const CHECK_INTERVAL = 5000;
// 本地服务探测超时，单位为毫秒
const CHECK_TIMEOUT = 800;
let checking = false;

/** 离线页遇到正在运行的本项目服务时切回在线入口 */
async function checkLiveEntry(): Promise<void> {
  if (checking || document.visibilityState === "hidden") {
    return;
  }
  checking = true;
  const controller = new AbortController();
  /** 超时后中止当前探测，离线绘图继续运行 */
  function abortCheck(): void {
    controller.abort();
  }
  const timer = window.setTimeout(abortCheck, CHECK_TIMEOUT);
  try {
    const response = await fetch(DEVELOPMENT_URL + "/__svg_board_runtime", {
      cache: "no-store",
      signal: controller.signal
    });
    const identity = await response.text();
    if (response.ok && identity === "svg-board-development") {
      window.location.replace(DEVELOPMENT_URL + "/editor.html");
    }
  } catch {
    // 服务未启动时继续使用当前离线文件
  } finally {
    window.clearTimeout(timer);
    checking = false;
  }
}

/** 仅本地文件监听开发服务，网页自身由 Vite 同步源码 */
export function syncLiveEntry(): void {
  if (window.location.protocol !== "file:") {
    return;
  }
  void checkLiveEntry();
  window.setInterval(checkLiveEntry, CHECK_INTERVAL);
  document.addEventListener("visibilitychange", checkLiveEntry);
}
