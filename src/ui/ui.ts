import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Circle,
  Copy,
  Diamond,
  Download,
  FolderOpen,
  Grid3x3,
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
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  X,
  createIcons
} from "lucide";
import { Crosshair, Equal, GitCommitHorizontal, TextCursorInput, LockKeyhole } from "lucide";
import { Eye, EyeOff, LockOpen } from "lucide";
import {
  Bold,
  Italic,
  Underline,
  Dot,
  RectangleHorizontal,
  PenTool,
  Spline,
  BookOpen
} from "lucide";
import { isGroupedTool } from "./tool-definitions";
import { createTextToolbar } from "./text-toolbar";
import { setupToolGroups } from "./tool-groups";
import type { Tool } from "../core/types";
import packageInfo from "../../package.json";
import { mountBrandIcon } from "./branding";
import { MIN_POLYGON_SIDES, MAX_REGULAR_SIDES, DEFAULT_POLYGON_SIDES } from "../core/model";
import { AlignLeft, AlignCenter, AlignRight, ChevronDown } from "lucide";
import { setupArchivePicker } from "./archive-picker";
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH, MAX_DESCRIPTION_LENGTH } from "../core/model";
import { Axis3d, ChartSpline, ChartScatter, UnfoldVertical } from "lucide";

// 日期时间刷新间隔，单位为毫秒
const CLOCK_INTERVAL = 1000;
// 状态栏显示时间所用的时区
const CLOCK_TIME_ZONE = "Asia/Shanghai";
// 日期时间的显示字段与格式
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

/** 工具栏按钮的配置，图标名与 Lucide 的公开名称一致 */
interface ToolDefinition {
  tool: Tool;
  label: string;
  icon: string;
}

// 左侧工具栏的顺序、名称与图标，分组后的工具只保留一个入口
const TOOLS: ToolDefinition[] = [
  { tool: "select", label: "选择", icon: "mouse-pointer-2" },
  { tool: "point", label: "几何点", icon: "dot" },
  { tool: "line", label: "线段", icon: "slash" },
  { tool: "rect", label: "矩形", icon: "rectangle-horizontal" },
  { tool: "diamond", label: "判断框", icon: "diamond" },
  { tool: "polygon", label: "正多边形", icon: "pentagon" },
  { tool: "ellipse", label: "椭圆", icon: "circle" },
  { tool: "arrow", label: "箭头", icon: "arrow-up-right" },
  { tool: "connector", label: "连接线", icon: "link-2" },
  { tool: "function", label: "函数绘制", icon: "chart-spline" },
  { tool: "fit", label: "点拟合", icon: "chart-scatter" },
  { tool: "pencil", label: "自由画笔", icon: "pencil" },
  { tool: "text", label: "文字", icon: "type" },
  { tool: "vertical-text", label: "纵向文本框", icon: "text-cursor-input" }
];

/** 更新左下角的北京时间，使用 time 元素同时保留机器可读的时间 */
function updateClock(): void {
  const element = getElement("current-time");
  const now = new Date();
  element.textContent = CLOCK_FORMAT.format(now);
  element.setAttribute("datetime", now.toISOString());
}

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
      Copy: Copy,
      Diamond: Diamond,
      Download: Download,
      FolderOpen: FolderOpen,
      Grid3x3: Grid3x3,
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
      Slash: Slash,
      Square: Square,
      Trash2: Trash2,
      Type: Type,
      Undo2: Undo2,
      Ungroup: Ungroup,
      X: X,
      Crosshair: Crosshair,
      Equal: Equal,
      GitCommitHorizontal: GitCommitHorizontal,
      TextCursorInput: TextCursorInput,
      LockKeyhole: LockKeyhole,
      LockOpen: LockOpen,
      Eye: Eye,
      EyeOff: EyeOff,
      Bold: Bold,
      Italic: Italic,
      Underline: Underline,
      Dot: Dot,
      RectangleHorizontal: RectangleHorizontal,
      PenTool: PenTool,
      Spline: Spline,
      BookOpen: BookOpen,
      AlignLeft: AlignLeft,
      AlignCenter: AlignCenter,
      AlignRight: AlignRight,
      ChevronDown: ChevronDown,
      Axis3d: Axis3d,
      ChartSpline: ChartSpline,
      ChartScatter: ChartScatter,
      UnfoldVertical: UnfoldVertical
    }
  });
}

/** 构建编辑器固定区域，动态对象和属性内容由各自模块更新 */
export function mountInterface(): void {
  mountBrandIcon();
  const app = getElement("app");
  let toolButtons = "";
  for (const definition of TOOLS) {
    if (
      definition.tool === "arrow" ||
      definition.tool === "connector" ||
      definition.tool === "vertical-text"
    ) {
      continue;
    }
    let group = "";
    let badge = "";
    if (definition.tool === "line") {
      group = ' data-tool-group="lines" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    if (definition.tool === "point") {
      group = ' data-tool-group="points" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    if (definition.tool === "text") {
      group = ' data-tool-group="text" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    if (definition.tool === "rect") {
      group = ' data-tool-group="rectangles" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    if (definition.tool === "polygon") {
      group = ' data-tool-group="polygons" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    if (definition.tool === "ellipse") {
      group = ' data-tool-group="ellipses" aria-haspopup="true" aria-expanded="false"';
      badge = '<span class="tool-more" aria-hidden="true"></span>';
    }
    toolButtons =
      toolButtons +
      '<button type="button" class="tool-button" data-tool="' +
      definition.tool +
      '" aria-label="' +
      definition.label +
      '" title="' +
      definition.label +
      '" aria-pressed="false"' +
      group +
      ">" +
      icon(definition.icon) +
      badge +
      "</button>";
  }
  const constructions = [
    { action: "segment", label: "两点直线", icon: "git-commit-horizontal" },
    { action: "intersection", label: "交点", icon: "crosshair" },
    { action: "midpoint", label: "中点", icon: "git-commit-horizontal" },
    { action: "parallel", label: "平行线", icon: "equal" },
    { action: "perpendicular", label: "垂线", icon: "plus" },
    { action: "bisector", label: "角平分线", icon: "unfold-vertical" }
  ];
  let constructionButtons = "";
  for (const construction of constructions) {
    let button = commandButton(
      "construct-" + construction.action,
      construction.label,
      construction.icon
    );
    if (construction.action === "midpoint") {
      button = button.replace(
        icon(construction.icon),
        '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 12h6m6 0h6M3 9v6m18-6v6"/><circle cx="12" cy="12" r="3"/></svg>'
      );
    }
    if (construction.action === "perpendicular") {
      button = button.replace(
        icon(construction.icon),
        '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19h18M12 4v15m0-5h5v5"/><circle cx="12" cy="4" r="1"/></svg>'
      );
    }
    constructionButtons = constructionButtons + button;
  }
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-symbol">${icon("pen-tool")}</span><h1>SVG<span>Board</span></h1></div>
      <div class="document-heading"><input id="document-name" aria-label="作品名称" maxlength="${MAX_NAME_LENGTH}" /><span id="save-status" role="status"></span></div>
      <div class="header-workspace"><div class="archive-picker"><button type="button" id="archive-select" role="combobox" aria-label="画图存档" aria-haspopup="listbox" aria-expanded="false" aria-controls="archive-options" popovertarget="archive-options"><span id="archive-label"></span>${icon("chevron-down")}</button></div><button type="button" class="icon-button" id="readonly-button" data-action="readonly" aria-label="只读模式" title="只读模式" aria-pressed="false">${icon("lock-keyhole")}</button><button type="button" class="icon-button" id="snap-button" data-action="snap" aria-label="自动吸附" title="自动吸附" aria-pressed="true">${icon("magnet")}</button><button type="button" class="icon-button" id="grid-button" data-action="grid" aria-label="显示网格" title="显示网格" aria-pressed="true">${icon("grid-3x3")}</button>${commandButton("undo", "撤销", "undo-2")}${commandButton("redo", "重做", "redo-2")}</div>
      <div class="file-actions">
        ${commandButton("new", "新建画板", "plus")}
        ${commandButton("open", "打开作品", "folder-open")}
        ${commandButton("save", "保存项目", "save")}
        ${commandButton("delete-archive", "删除当前存档", "trash-2")}
        <button type="button" class="primary-button" data-action="export" aria-label="导出" title="导出">${icon("download")}<span>导出</span></button>
      </div>
    </header>
    <main class="workspace">
      <nav class="tools" aria-label="绘图工具">${toolButtons}<div class="tool-divider"></div><div class="geometry-tools" role="group" aria-label="几何构造">${constructionButtons}</div><div class="tool-divider"></div><label class="toolbar-color" title="新图形描边颜色"><input id="tool-stroke" type="color" value="#334155" aria-label="新图形描边颜色" /></label></nav>
      <section id="canvas-host" class="canvas-host" aria-label="画布工作区"><span class="canvas-label">无限画布</span></section>
      <button type="button" class="icon-button inspector-toggle" id="inspector-button" data-action="toggle-inspector" aria-label="说明" title="说明" aria-pressed="true" aria-expanded="true" aria-controls="inspector">${icon("book-open")}</button>
      <aside class="inspector" id="inspector" aria-label="说明">
        <div class="inspector-tabs"><button type="button" id="properties-tab" class="active" data-action="tab-properties" aria-pressed="true">属性</button><button type="button" id="objects-tab" data-action="tab-objects" aria-pressed="false">对象管理 <span id="object-manager-count">0</span></button><button type="button" id="description-tab" data-action="tab-description" aria-pressed="false">说明</button></div>
        <div id="properties-panel"></div><div id="objects-panel" hidden><section class="property-section"><div id="selected-object-management"></div></section><div id="object-list"></div></div>
        <section id="description-panel" class="description-panel" hidden><div class="section-title"><h2>项目介绍</h2><button type="button" class="text-button" data-action="description-edit">编辑</button></div><textarea id="description-editor" aria-label="项目介绍 Markdown" rows="10" maxlength="${MAX_DESCRIPTION_LENGTH}" hidden></textarea><article id="description-preview" class="markdown-preview"></article></section>
        <p id="construction-status" class="relationship-status" role="status"></p>
        <div class="inspector-foot">SVG-Board</div>
      </aside>
    </main>
    <footer class="statusbar"><div class="status-left"><div class="release-info"><time id="current-time" aria-label="当前北京时间" title="北京时间（Asia/Shanghai）"></time><span id="app-version" aria-label="应用版本">v${packageInfo.version}</span></div><div class="object-status"><span class="status-dot"></span><span id="object-count">0 个对象</span><span id="selection-count"></span></div></div><span id="board-size" class="board-size">1200 × 800</span><div class="zoom-controls">${commandButton("zoom-out", "缩小画布", "minus")}<button type="button" id="zoom-value" data-action="reset-zoom" title="恢复 100%">100%</button>${commandButton("zoom-in", "放大画布", "plus")}${commandButton("fit", "适应画布", "maximize")}</div></footer>
    <div id="message" class="message" role="status" hidden></div>
    <input id="file-input" type="file" accept=".json,.svg" hidden />
    <dialog id="text-dialog"><form id="text-form"><div class="dialog-heading"><h2>编辑文字</h2>${commandButton("close-text", "关闭文字编辑", "x")}</div><label for="text-value">文字内容</label><textarea id="text-value" rows="5" maxlength="${MAX_TEXT_LENGTH}"></textarea><div class="dialog-actions"><button type="button" data-action="close-text">取消</button><button type="submit" class="primary-button">保存文字</button></div></form></dialog>
    <dialog id="delete-dialog"><div class="dialog-heading"><h2>删除存档</h2>${commandButton("cancel-delete", "取消删除", "x")}</div><p id="delete-archive-name"></p><p>此操作无法撤销</p><div class="dialog-actions"><button type="button" data-action="cancel-delete">取消</button><button type="button" class="danger-button" data-action="confirm-delete">删除存档</button></div></dialog>
    <div id="tool-menu" class="tool-menu" popover="manual" role="group" aria-label="工具模式"></div>
    <div id="archive-options" class="archive-options" popover="auto" role="listbox" aria-label="画图存档选项"></div>
    <dialog id="polygon-dialog"><form id="polygon-form"><div class="dialog-heading"><h2>正多边形</h2>${commandButton("close-polygon", "关闭多边形设置", "x")}</div><label for="polygon-sides">边数</label><input id="polygon-sides" type="number" min="${MIN_POLYGON_SIDES}" max="${MAX_REGULAR_SIDES}" step="1" value="${DEFAULT_POLYGON_SIDES}" /><div class="dialog-actions"><button type="submit" class="primary-button">开始绘制</button></div></form></dialog>
    <dialog id="export-dialog"><div class="dialog-heading"><h2>导出作品</h2>${commandButton("close-export", "关闭导出", "x")}</div><div id="export-preview" class="export-preview"></div><p id="export-error" role="status"></p><div class="dialog-actions"><button type="button" data-action="export-project">导出项目</button><button type="button" data-action="export-svg">导出 SVG</button><button type="button" class="primary-button" data-action="export-png">导出 PNG</button></div></dialog>
  `;
  refreshIcons();
  createTextToolbar(getElement("canvas-host"));
  refreshIcons();
  updateClock();
  window.setInterval(updateClock, CLOCK_INTERVAL);
  setupToolGroups();
  setupArchivePicker();
}

/** 验证工具名，仅将已知工具交给画布 */
export function isTool(value: string): value is Tool {
  if (value === "hand") {
    return true;
  }
  if (isGroupedTool(value)) {
    return true;
  }
  for (const definition of TOOLS) {
    if (definition.tool === value) {
      return true;
    }
  }
  return false;
}
