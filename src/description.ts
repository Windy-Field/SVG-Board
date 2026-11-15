import { marked } from "marked";
import DOMPurify from "dompurify";

/** 同步作品说明，预览先净化 HTML，禁止说明内容执行脚本 */
export function updateDescription(text: string, readonly: boolean): void {
  const editor = document.getElementById("description-editor");
  const preview = document.getElementById("description-preview");
  if (editor instanceof HTMLTextAreaElement) {
    if (document.activeElement !== editor) {
      editor.value = text;
    }
    editor.disabled = readonly;
  }
  if (preview !== null) {
    const html = marked.parse(text, { async: false });
    preview.innerHTML = DOMPurify.sanitize(html, {
      FORBID_TAGS: ["img", "iframe", "style", "form"],
      FORBID_ATTR: ["style"]
    });
    for (const link of preview.querySelectorAll("a")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
}
