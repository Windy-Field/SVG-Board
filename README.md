# SVG-Board

当前版本：`1.0.1`。后续小更新递增补丁号

面向课程作业与实验报告的轻量矢量绘图编辑器。使用 TypeScript 严格类型检查和基础 JavaScript 写法，通用图形编辑能力复用 Fabric.js，项目代码负责关系模型、几何构造和作品管理

## 当前功能

- 矩形、椭圆、判断框、线段、箭头、自由画笔、文字和几何点
- 选择、框选、Shift 多选、移动、缩放、旋转、复制粘贴、删除
- 描边、填充、虚线、线宽、透明度、字体、字号和文字对齐
- 图层顺序、锁定、隐藏、逻辑组合与取消组合
- 左对齐、顶对齐、水平等距分布、统一宽度、网格吸附
- 关联连接线，移动或缩放节点时端点随动
- 两点线段、中点、直线交点、过点平行线与垂线，来源变化后自动重算
- 撤销重做、浏览器自动恢复、项目文件保存与打开
- SVG / PNG 导出，支持内容裁剪、透明背景、隐藏辅助对象和导出预览
- 本工具导出的 SVG 包含项目元数据，可重新打开并继续编辑
- 可编辑的流程图和三角形中线模板

## 环境与启动

建议 Node.js 22.12 或更新的 LTS 版本，使用当前 Chrome、Edge 或 Firefox。已在 Windows、Node.js 24 和 Edge 无头浏览器中验证

```bash
npm ci
npm run dev
```

终端会显示访问地址，默认是 `http://127.0.0.1:5173`，端口占用时 Vite 会选择可用端口

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`lint` 使用 TypeScript 语法树检查项目禁止的写法与函数说明，不能代替人工检查注释质量和业务逻辑。代码格式化使用 `npm run format`，格式检查使用 `npm run format:check`

浏览器测试首次运行需要安装 Playwright 的 Chromium：

```bash
npx playwright install chromium
npm run test:browser
```

Windows 已安装 Edge 时也可使用 PowerShell：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:browser
```

## 使用方式

打开页面直接进入工作台，首次进入显示可编辑的流程图。左上角加号新建空白画板，文件夹按钮打开项目，保存按钮下载 `.svgboard.json` 项目文件

左侧选择工具后在画板拖动绘制，完成后会自动切回选择工具并选中新对象。鼠标悬停时显示对象轮廓，细线按实际笔画响应点击。选择工具下可拖动对象及其控制点；框选需完整包住对象，Shift 可增减选择。双击节点修改标签，双击独立文字可直接编辑。右侧修改对象属性，图层页可找回隐藏对象

连接线工具从一个矩形、椭圆或判断框拖向另一个节点。几何构造先选来源，再点击右侧构造命令：两点线段选两个点，中点选一条线段，交点选两条线，平行线或垂线选一条线和一个点。交点按无限延伸的直线计算；平行或重合时没有唯一交点，结果隐藏并提示

独立点可拖动；构造点由来源决定，不能直接拖离关系。删除来源会同时删除依赖它的构造，可用撤销恢复。隐藏来源也会暂时隐藏依赖结果

常用快捷键：`Ctrl/Command+Z` 撤销、`Ctrl/Command+Shift+Z` 或 `Ctrl+Y` 重做、`Ctrl/Command+C/V` 内部复制粘贴、`Ctrl/Command+S` 保存、`Delete` 删除、方向键微移、`Shift+方向键` 移动 10 个单位。`Escape` 可取消绘制或撤回尚未松开鼠标的变换。普通滚轮平移，`Ctrl/Command+滚轮` 缩放，按住空格拖动可临时平移，松开后恢复原工具和选区。快捷键不干扰输入框和文字编辑

## 保存与边界

自动恢复数据仅存在当前浏览器和当前站点，本地文件保存不能由它替代。清除浏览器数据或更换访问端口会失去该站点的恢复记录。作品不会上传到服务器

目前只支持打开 SVG-Board 项目和本工具导出的 SVG，不承诺任意外部 SVG 的无损导入。SVG 元数据只作为 JSON 读取，外部 SVG 不直接插入页面。文件最多 8 MB、对象最多 2000 个

首版不包括任意多边形工具、尺寸与角度标注、复杂自动避障布线、协作、函数曲线或 AI 在线接口。手机可查看、缩放和基本编辑，复杂精确绘制建议使用桌面端。组合是逻辑分组，并非通用 SVG 嵌套组编辑器

## 技术与结构

| 文件                                           | 职责                               |
| ---------------------------------------------- | ---------------------------------- |
| `src/types.ts`、`src/model.ts`                 | 作品类型、基础对象操作与历史       |
| `src/canvas.ts`、`src/fabric-shapes.ts`        | Fabric 交互适配和对象显示          |
| `src/geometry.ts`、`src/commands.ts`           | 构造计算、依赖更新和对象命令       |
| `src/document.ts`、`src/files.ts`              | 文件校验、导入、保存与导出         |
| `src/ui.ts`、`src/inspector.ts`、`src/main.ts` | 界面、属性面板和应用连接           |
| `src/styles.css`、`tokens.css`                 | 布局与视觉样式                     |
| `tests/`                                       | 模型与浏览器功能验证               |
| `scripts/check-style.mjs`                      | 正式项目风格检查工具，不是临时脚本 |

## 第三方资源与许可

优先通过官方仓库、npm 包信息和安装包类型定义核对功能与接口，不从来源不明的代码片段拼接实现。依赖确切版本以 `package-lock.json` 为准，原始许可保留在安装包中

| 资源       | 版本（当前安装） | 来源                                                                             | 许可                           | 用途                                       |
| ---------- | ---------------- | -------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| Fabric.js  | 7.4.0            | [官方仓库](https://github.com/fabricjs/fabric.js)、[文档](https://fabricjs.com/) | MIT                            | 选择框、框选、变换、文字、笔刷、SVG 序列化 |
| Flatten.js | 1.6.15           | [官方仓库](https://github.com/alexbol99/flatten-js)                              | MIT                            | 中点、直线交点等二维计算                   |
| Lucide     | 0.468.0          | [官方仓库](https://github.com/lucide-icons/lucide)                               | ISC，部分图标保留 MIT 来源声明 | 工具栏图标                                 |
| TypeScript | 依 lockfile      | [官方仓库](https://github.com/microsoft/TypeScript)                              | Apache-2.0                     | 类型检查与风格语法树分析                   |
| Vite       | 依 lockfile      | [官方仓库](https://github.com/vitejs/vite)                                       | MIT                            | 开发服务与生产构建                         |
| Playwright | 依 lockfile      | [官方仓库](https://github.com/microsoft/playwright)                              | Apache-2.0                     | 浏览器功能验证                             |
| tsx        | 依 lockfile      | [官方仓库](https://github.com/privatenumber/tsx)                                 | MIT                            | 执行 TypeScript 模型测试                   |
| Prettier   | 依 lockfile      | [官方仓库](https://github.com/prettier/prettier)                                 | MIT                            | 代码格式化                                 |

流程图、几何模板和界面由本项目创建，没有引用外部照片、数据集或在线字体。字体使用用户系统已有字体，不分发字体文件。完整的运行时依赖声明见 `THIRD_PARTY_NOTICES.md`

本项目不是 Fabric.js 编辑器成品的换皮：它将 Fabric.js 作为库使用，自行实现可保存的依赖模型、关系更新、构造命令、文件校验与工作台界面。参赛时仍应向主办方确认所选赛道，不能据此保证赛道归属

## AI 工具使用声明

本项目使用 OpenAI Codex 辅助方案讨论、官方资料核对、代码生成、类型检查、测试编写、问题定位和修复。用户提出产品方向、复用优先原则和强制代码风格，AI 据此实施当前版本

截至本版本，尚不宣称用户已经完成全部实现的逐项审阅、核心设计确认或实质性修改。参赛提交前，参与者应亲自验证作品、理解核心实现并完成必要的设计决策与修改，如实补充实际协作与提交记录。不能将 AI 生成内容表述为全部由人独立编写
