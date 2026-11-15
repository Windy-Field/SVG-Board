import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Circle,
  ClipboardPaste,
  Copy,
  Diamond,
  Download,
  FolderOpen,
  Grid3x3,
  Hand,
  Link2,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Pentagon,
  Pencil,
  Plus,
  Redo2,
  Save,
  Settings2,
  Slash,
  Square,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Ungroup,
  X,
  createIcons
} from "lucide";
import type { Tool } from "./types";
import packageInfo from "../package.json";

const CLOCK_INTERVAL = 1000;
const CLOCK_TIME_ZONE = "Asia/Shanghai";
const CLOCK_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: CLOCK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

/** 更新左下角的北京时间，使用 time 元素同时保留机器可读的时间 */
function updateClock(): void {
  const element = getElement("current-time");
  const now = new Date();
  element.textContent = CLOCK_FORMAT.format(now);
  element.setAttribute("datetime", now.toISOString());
}

/** 工具栏按钮的配置，图标名与 Lucide 的公开名称一致 */
interface ToolDefinition {
  tool: Tool;
  label: string;
  icon: string;
}

const TOOLS: ToolDefinition[] = [
  { tool: "select", label: "选择", icon: "mouse-pointer-2" },
  { tool: "hand", label: "平移", icon: "hand" },
  { tool: "rect", label: "矩形", icon: "square" },
  { tool: "ellipse", label: "椭圆", icon: "circle" },
  { tool: "diamond", label: "判断框", icon: "diamond" },
  { tool: "line", label: "线段", icon: "slash" },
  { tool: "arrow", label: "箭头", icon: "arrow-up-right" },
  { tool: "connector", label: "连接线", icon: "link-2" },
  { tool: "pencil", label: "自由画笔", icon: "pencil" },
  { tool: "text", label: "文字", icon: "type" },
  { tool: "point", label: "几何点", icon: "pentagon" }
];

/** 返回静态图标标记，传入名称仅来自本模块配置 */
function icon(name: string): string {
  return '<i data-lucide="' + name + '" aria-hidden="true"></i>';
}

/** 创建带无障碍名称和悬停说明的命令按钮 */
export function commandButton(action: string, label: string, iconName: string): string {
  return (
    '<button type="button" class="icon-button" data-action="' +
    action +
    '" aria-label="' +
    label +
    '" title="' +
    label +
    '">' +
    icon(iconName) +
    "</button>"
  );
}

/** 用运行时检查获取必需元素，缺失时报告具体编号 */
export function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error("界面缺少元素：" + id);
  }
  return element;
}

/** 获取输入控件，通过真实类型检查替代强制类型断言 */
export function getInput(id: string): HTMLInputElement {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("界面输入控件不正确：" + id);
  }
  return element;
}

/** 替换新生成的图标标记，使用单一图标库保持线条一致 */
export function refreshIcons(): void {
  createIcons({
    icons: {
      ArrowDown: ArrowDown,
      ArrowUp: ArrowUp,
      ArrowUpRight: ArrowUpRight,
      Circle: Circle,
      ClipboardPaste: ClipboardPaste,
      Copy: Copy,
      Diamond: Diamond,
      Download: Download,
      FolderOpen: FolderOpen,
      Grid3x3: Grid3x3,
      Hand: Hand,
      Link2: Link2,
      Magnet: Magnet,
      Maximize: Maximize,
      Minus: Minus,
      MousePointer2: MousePointer2,
      Pentagon: Pentagon,
      Pencil: Pencil,
      Plus: Plus,
      Redo2: Redo2,
      Save: Save,
      Settings2: Settings2,
      Slash: Slash,
      Square: Square,
      Trash2: Trash2,
      Triangle: Triangle,
      Type: Type,
      Undo2: Undo2,
      Ungroup: Ungroup,
      X: X
    }
  });
}

/** 构建编辑器固定区域，动态对象和属性内容由各自模块更新 */
export function mountInterface(): void {
  const app = getElement("app");
  let toolButtons = "";
  for (const definition of TOOLS) {
    toolButtons =
      toolButtons +
      '<button type="button" class="tool-button" data-tool="' +
      definition.tool +
      '" aria-label="' +
      definition.label +
      '" title="' +
      definition.label +
      '" aria-pressed="false">' +
      icon(definition.icon) +
      "</button>";
  }
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-symbol">${icon("pentagon")}</span><h1>SVG<span>Board</span></h1></div>
      <div class="document-heading"><input id="document-name" aria-label="作品名称" maxlength="100" /><span id="save-status" role="status">本地画板</span></div>
      <div class="file-actions">
        ${commandButton("new", "新建画板", "plus")}
        ${commandButton("open", "打开作品", "folder-open")}
        ${commandButton("save", "保存项目", "save")}
        <button type="button" class="primary-button" data-action="export">${icon("download")}<span>导出</span></button>
      </div>
    </header>
    <div class="commandbar">
      <div class="command-group">${commandButton("undo", "撤销", "undo-2")}${commandButton("redo", "重做", "redo-2")}</div>
      <div class="command-group">${commandButton("copy", "复制", "copy")}${commandButton("paste", "粘贴", "clipboard-paste")}${commandButton("delete", "删除", "trash-2")}</div>
      <div class="command-group arrangement"><button type="button" class="text-button" data-action="align-left">左对齐</button><button type="button" class="text-button" data-action="align-top">顶对齐</button><button type="button" class="text-button" data-action="distribute">水平等距</button></div>
      <div class="command-spacer"></div>
      <button type="button" class="icon-button" id="grid-button" data-action="grid" aria-label="显示网格" title="显示网格" aria-pressed="true">${icon("grid-3x3")}</button>
      <button type="button" class="icon-button" id="snap-button" data-action="snap" aria-label="网格吸附" title="网格吸附" aria-pressed="false">${icon("magnet")}</button>
      <button type="button" class="icon-button" data-action="toggle-inspector" aria-label="属性与图层" title="属性与图层">${icon("settings-2")}</button>
    </div>
    <main class="workspace">
      <nav class="tools" aria-label="绘图工具">${toolButtons}<div class="tool-divider"></div><label class="toolbar-color" title="新图形描边颜色"><input id="tool-stroke" type="color" value="#334155" aria-label="新图形描边颜色" /></label></nav>
      <section id="canvas-host" class="canvas-host" aria-label="画布工作区"><span class="canvas-label">画板 01</span></section>
      <aside class="inspector" id="inspector" aria-label="属性与图层">
        <div class="inspector-tabs"><button type="button" id="properties-tab" class="active" data-action="tab-properties" aria-pressed="true">属性</button><button type="button" id="layers-tab" data-action="tab-layers" aria-pressed="false">图层 <span id="layer-count">0</span></button></div>
        <div id="properties-panel"></div><div id="layers-panel" hidden></div>
        <section class="construction-section"><h2>${icon("triangle")} 几何构造</h2><div class="construction-grid"><button type="button" data-action="construct-segment">两点线段</button><button type="button" data-action="construct-midpoint">中点</button><button type="button" data-action="construct-intersection">交点</button><button type="button" data-action="construct-parallel">平行线</button><button type="button" data-action="construct-perpendicular">垂线</button></div><p id="construction-status" class="relationship-status" role="status"></p></section>
        <section class="template-section"><h2>画板模板</h2><button type="button" class="template-row" data-action="template-flow">${icon("link-2")}<span>程序流程图</span><span class="template-arrow">↗</span></button><button type="button" class="template-row" data-action="template-geometry">${icon("triangle")}<span>三角形中线</span><span class="template-arrow">↗</span></button></section>
        <div class="inspector-foot">SVG-Board</div>
      </aside>
    </main>
    <footer class="statusbar"><div class="status-left"><div class="release-info"><time id="current-time" aria-label="当前北京时间" title="北京时间（Asia/Shanghai）"></time><span id="app-version" aria-label="应用版本">v${packageInfo.version}</span></div><div class="object-status"><span class="status-dot"></span><span id="object-count">0 个对象</span><span id="selection-count"></span></div></div><span id="board-size" class="board-size">1200 × 800</span><div class="zoom-controls">${commandButton("zoom-out", "缩小画布", "minus")}<button type="button" id="zoom-value" data-action="reset-zoom" title="恢复 100%">100%</button>${commandButton("zoom-in", "放大画布", "plus")}${commandButton("fit", "适应画布", "maximize")}</div></footer>
    <div id="message" class="message" role="status" hidden></div>
    <input id="file-input" type="file" accept=".json,.svg" hidden />
    <dialog id="text-dialog"><form id="text-form"><div class="dialog-heading"><h2>编辑文字</h2>${commandButton("close-text", "关闭文字编辑", "x")}</div><label for="text-value">文字内容</label><textarea id="text-value" rows="5" maxlength="10000"></textarea><div class="dialog-actions"><button type="button" data-action="close-text">取消</button><button type="submit" class="primary-button">保存文字</button></div></form></dialog>
    <dialog id="export-dialog"><div class="dialog-heading"><h2>导出作品</h2>${commandButton("close-export", "关闭导出", "x")}</div><div class="export-options"><label><input id="export-crop" type="checkbox" checked /> 按内容裁剪</label><label><input id="export-transparent" type="checkbox" /> 透明背景</label><label><input id="export-auxiliary" type="checkbox" checked /> 隐藏辅助对象</label></div><div id="export-preview" class="export-preview"></div><p id="export-error" role="status"></p><div class="dialog-actions"><button type="button" data-action="export-svg">导出 SVG</button><button type="button" class="primary-button" data-action="export-png">导出 PNG</button></div></dialog>
  `;
  refreshIcons();
  updateClock();
  window.setInterval(updateClock, CLOCK_INTERVAL);
}

/** 验证工具名，仅将已知工具交给画布 */
export function isTool(value: string): value is Tool {
  for (const definition of TOOLS) {
    if (definition.tool === value) {
      return true;
    }
  }
  return false;
}
