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
