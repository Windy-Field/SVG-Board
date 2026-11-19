import type { BoardDocument } from "../core/types";
import { createSvg, downloadBlob, exportPng, getFileName, saveProject } from "../storage/files";
import { getDialog, getElement } from "./ui";
import { afterDialogExit } from "./motion";

let exporting = false;

/** 关闭窗口时释放预览地址，避免一直占用图片内存 */
export function setupExportDialog(): void {
  const dialog = getDialog("export-dialog");
  afterDialogExit(dialog, clearPreview);
  dialog.addEventListener("cancel", cancelExportDialog);
}

/** PNG 仍在生成时保留窗口，让用户看见处理结果 */
function cancelExportDialog(event: Event): void {
  if (exporting) {
    event.preventDefault();
  }
}

/** 清理上一张预览，不影响正在生成的下载文件 */
function clearPreview(): void {
  const preview = getElement("export-preview");
  const image = preview.querySelector("img");
  if (image !== null) {
    URL.revokeObjectURL(image.src);
    image.remove();
  }
}

/** 预览、SVG 和 PNG 使用相同的裁剪与透明背景设置 */
function renderSvg(board: BoardDocument): string {
  return createSvg(board, { crop: true, transparent: true, hideAuxiliary: true });
}

/** 在对话框内显示处理结果，避免提示被遮罩挡住 */
function showExportStatus(message: string, state: string): void {
  const status = getElement("export-status");
  status.dataset.state = state;
  status.textContent = message;
}

/** 生成独立的预览图片，不把 SVG 内容插入页面 */
function showPreview(board: BoardDocument): void {
  const svg = renderSvg(board);
  const image = new Image();
  image.alt = "导出预览";
  image.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const preview = getElement("export-preview");
  preview.append(image);
}

/** 锁定导出和关闭按钮，防止重复生成 PNG */
function setExporting(active: boolean): void {
  exporting = active;
  const dialog = getDialog("export-dialog");
  for (const button of dialog.querySelectorAll("button")) {
    button.disabled = active;
  }
  getElement("export-preview").setAttribute("aria-busy", String(active));
}

/** 处理导出窗口命令，下载开始后不把它报告为已保存到磁盘 */
export async function handleExportAction(action: string, board: BoardDocument): Promise<void> {
  const dialog = getDialog("export-dialog");
  if (exporting) {
    return;
  }
  if (action === "close-export") {
    dialog.close();
    return;
  }
  if (action === "export") {
    clearPreview();
    showExportStatus("", "");
    dialog.showModal();
    try {
      showPreview(board);
    } catch {
      showExportStatus("无法生成预览，可尝试导出项目", "error");
    }
    return;
  }
  if (!dialog.open) {
    return;
  }
  const focused = document.activeElement;
  try {
    if (action === "export-project") {
      saveProject(board);
      showExportStatus("已发起项目下载", "success");
    } else if (action === "export-svg") {
      const filename = getFileName(board.name) + ".svg";
      downloadBlob(new Blob([renderSvg(board)], { type: "image/svg+xml" }), filename);
      showExportStatus("已发起 SVG 下载", "success");
    } else if (action === "export-png") {
      setExporting(true);
      showExportStatus("正在生成 PNG", "pending");
      await exportPng(renderSvg(board), board.name);
      showExportStatus("已发起 PNG 下载", "success");
    }
  } catch (error) {
    let message = "请重试";
    if (error instanceof Error) {
      message = error.message;
    }
    showExportStatus("导出失败：" + message, "error");
  } finally {
    if (exporting) {
      setExporting(false);
      if (focused instanceof HTMLButtonElement) {
        focused.focus();
      }
    }
  }
}
