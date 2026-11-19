/** 等对话框淡出后再清理预览，重新打开时保留新内容 */
export function afterDialogExit(dialog: HTMLDialogElement, cleanup: () => void): void {
  let closeCount = 0;
  dialog.addEventListener("close", cleanAfterExit);

  /** 等待浏览器完成或取消当前过渡，过期的关闭事件不清理新内容 */
  async function cleanAfterExit(): Promise<void> {
    if (dialog.open) {
      return;
    }
    closeCount = closeCount + 1;
    const currentClose = closeCount;
    const transitions = dialog.getAnimations();
    const finished: Promise<Animation>[] = [];
    for (const transition of transitions) {
      finished.push(transition.finished);
    }
    await Promise.allSettled(finished);
    if (!dialog.open && currentClose === closeCount) {
      cleanup();
    }
  }
}

/** 同步侧栏、按钮和画布布局，出现与退出效果交给样式维护 */
export function setSidebar(open: boolean): void {
  const workspace = document.querySelector(".workspace");
  const panel = document.getElementById("inspector");
  const button = document.getElementById("inspector-button");
  if (!(workspace instanceof HTMLElement) || panel === null || button === null) {
    return;
  }
  const closed = workspace.classList.contains("inspector-hidden");
  if (open === !closed) {
    return;
  }
  workspace.classList.toggle("inspector-hidden", !open);
  panel.inert = !open;
  button.setAttribute("aria-pressed", String(open));
  button.setAttribute("aria-expanded", String(open));
}
