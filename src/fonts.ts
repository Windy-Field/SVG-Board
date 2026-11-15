/** 字体仅使用本机已安装字体，不请求外部字体资源 */
export const FONTS = [
  { value: "sans-serif", label: "黑体" },
  { value: "Microsoft YaHei", label: "微软雅黑" },
  { value: "SimSun", label: "宋体" },
  { value: "KaiTi", label: "楷体" },
  { value: "serif", label: "衬线体" },
  { value: "monospace", label: "等宽字体" },
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" }
];

/** 检查导入文件中的字体是否在支持列表中 */
export function isFont(value: string): boolean {
  for (const font of FONTS) {
    if (font.value === value) {
      return true;
    }
  }
  return false;
}

/** 为浮动栏与属性面板生成相同的字体选项 */
export function fontOptions(): string {
  let html = "";
  for (const font of FONTS) {
    html = html + '<option value="' + font.value + '">' + font.label + "</option>";
  }
  return html;
}
