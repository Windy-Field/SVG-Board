# 项目结构

[返回 README](../README.md)

SVG-Board 的界面、画布交互、几何计算和文件存储分别放在不同目录中。阅读源码时，可以先看 `src/app/main.ts`，了解一次操作如何从界面进入画布，再更新作品和存档

## 目录总览

下面的目录树列出主要目录和根目录文件，各目录中的文件在后文逐一说明

```text
SVG-Board/
|-- config/                 # 开发、构建、测试和格式化配置
|-- docs/                   # 项目文档与界面截图
|   `-- images/             # README 使用的截图
|-- examples/               # 可以直接打开的示例作品
|-- scripts/                # 开发、构建和维护脚本
|-- src/                    # 编辑器源码
|   |-- app/                # 应用入口与操作调度
|   |-- canvas/             # 画布显示、鼠标交互和控制点
|   |-- core/               # 作品模型、类型和通用命令
|   |-- geometry/           # 几何关系、吸附和框选计算
|   |-- math/               # 数学坐标、函数和拟合计算
|   |-- objects/            # 图形路径、标签和内置作品
|   |-- storage/            # 存档、文件校验和导入导出
|   |-- styles/             # 布局、颜色和动效样式
|   `-- ui/                 # 工具栏、属性面板和对话框
|-- tests/                  # 模型、数学和规范检查测试
|   `-- browser/            # 浏览器中的交互测试
|-- artifacts/              # 本地生成的构建、测试和日志文件
|-- node_modules/           # npm 安装的第三方依赖
|-- .gitignore              # 不提交到 Git 的文件规则
|-- AGENTS.md               # 本地开发约定，不提交到 Git
|-- editor.html             # 编辑器的开发与构建入口
|-- index.html              # 双击打开时选择开发页或离线页
|-- LICENSE                 # 项目许可证
|-- package.cmd             # Windows 本地打包入口
|-- package.json            # 应用版本、依赖和 npm 命令
|-- package-lock.json       # 锁定依赖的实际安装版本
|-- README.md               # 功能介绍、启动方式和使用说明
`-- tsconfig.json           # TypeScript 严格类型检查配置
```

`artifacts/` 和 `node_modules/` 是本地生成的目录，不提交到 Git。`.git/` 保存版本记录，由 Git 管理

## 应用入口

| 文件                                      | 职责                                                                                   |
| :---------------------------------------- | :------------------------------------------------------------------------------------- |
| [main.ts](../src/app/main.ts)             | 初始化界面、画布和存档，接收按钮及键盘操作，协调属性更新、几何联动、撤销重做和自动保存 |
| [live-entry.ts](../src/app/live-entry.ts) | 离线页面定期检查本地开发服务，服务可用时切换到开发页面                                 |

根目录的 `index.html` 负责选择打开方式，`editor.html` 加载 `main.ts`，实际编辑器由 TypeScript 源码构建

## 作品模型

`src/core/` 定义作品在程序中如何保存。画布显示和文件导出都使用这份模型，Fabric 对象负责显示和交互

| 文件                                       | 职责                                                             |
| :----------------------------------------- | :--------------------------------------------------------------- |
| [types.ts](../src/core/types.ts)           | 定义作品、图形、工具、几何关系和视口的数据类型                   |
| [model.ts](../src/core/model.ts)           | 维护共享参数，创建和查找对象，计算边界，提供移动、缩放及历史快照 |
| [commands.ts](../src/core/commands.ts)     | 执行删除、复制粘贴、对齐、层级调整和几何构造命令                 |
| [validation.ts](../src/core/validation.ts) | 判断未知输入是否为普通记录对象，供文件和存档校验复用             |

应用版本来自 `package.json`。项目文件的格式版本在作品模型中维护，两者用途不同

## 画布与交互

`src/canvas/` 连接作品模型和 Fabric.js，处理对象显示、选择、绘制和拖动

| 文件                                                       | 职责                                                                   |
| :--------------------------------------------------------- | :--------------------------------------------------------------------- |
| [canvas.ts](../src/canvas/canvas.ts)                       | 管理画布和选区，处理绘图、平移、缩放、框选及模型与显示对象之间的同步   |
| [editor-canvas.ts](../src/canvas/editor-canvas.ts)         | 扩展 Fabric 的目标命中处理，保留已选对象，并调整文字与线条的选择优先级 |
| [fabric-shapes.ts](../src/canvas/fabric-shapes.ts)         | 将模型转换为 Fabric 图形和标签，更新图形位置、尺寸与显示样式           |
| [line-controls.ts](../src/canvas/line-controls.ts)         | 处理线条端点和连接线折点手柄，保留构造线的方向约束                     |
| [curve-controls.ts](../src/canvas/curve-controls.ts)       | 创建和处理贝塞尔曲线的方向控制点                                       |
| [overlap-selection.ts](../src/canvas/overlap-selection.ts) | 记录重复点击位置，让用户轮换选择重叠对象                               |
| [canvas-feedback.ts](../src/canvas/canvas-feedback.ts)     | 绘制悬停轮廓、框选提示和锁标记，这些提示不写入作品                     |
| [axes.ts](../src/canvas/axes.ts)                           | 绘制数学坐标轴，计算随缩放变化的刻度与比例尺分度                       |

## 几何计算

`src/geometry/` 处理几何关系和位置判断，界面按钮与画布事件通过这些函数完成计算

| 文件                                                           | 职责                                                                     |
| :------------------------------------------------------------- | :----------------------------------------------------------------------- |
| [geometry.ts](../src/geometry/geometry.ts)                     | 计算中点、交点、平行线、垂线和角平分线，更新来源对象与构造对象之间的关系 |
| [construction-tools.ts](../src/geometry/construction-tools.ts) | 判断几何工具所需的来源数量和类型，支持先选工具或先选对象两种方式         |
| [extended-lines.ts](../src/geometry/extended-lines.ts)         | 根据显示范围裁剪射线和直线                                               |
| [outlines.ts](../src/geometry/outlines.ts)                     | 提取图形边框上的点，供吸附和框选使用                                     |
| [snapping.ts](../src/geometry/snapping.ts)                     | 按交点、端点与顶点、边框、网格的顺序寻找吸附位置，也处理曲线和坐标轴     |
| [marquee.ts](../src/geometry/marquee.ts)                       | 判断框选范围是否覆盖图形笔画                                             |

构造对象通过来源编号保存关联。来源对象变化后，程序重新计算结果；锁定状态限制直接移动和旋转，来源联动仍会继续

## 数学绘图

| 文件                                         | 职责                                                     |
| :------------------------------------------- | :------------------------------------------------------- |
| [coordinates.ts](../src/math/coordinates.ts) | 转换数学坐标和画布坐标，解析批量坐标输入并检查范围       |
| [expressions.ts](../src/math/expressions.ts) | 检查并编译允许的单变量表达式，计算指定横坐标对应的函数值 |
| [plots.ts](../src/math/plots.ts)             | 计算多项式拟合、采样函数路径，并生成曲线旁的解析式文字   |

数学坐标与画布坐标的原点和纵轴方向不同，转换统一通过 `coordinates.ts` 完成。函数计算使用 mathjs，拟合使用 ML.js，坐标轴分度使用 d3-array

## 图形与标签

| 文件                                              | 职责                                                   |
| :------------------------------------------------ | :----------------------------------------------------- |
| [shapes.ts](../src/objects/shapes.ts)             | 生成正多边形顶点和初始贝塞尔路径，收紧多边形的外框     |
| [point-labels.ts](../src/objects/point-labels.ts) | 按顺序生成点名，创建独立点名文本，并补齐旧作品中的点名 |
| [shape-labels.ts](../src/objects/shape-labels.ts) | 将图形和线条上的标签转换为可单独操作的文本对象         |
| [templates.ts](../src/objects/templates.ts)       | 创建流程图和三角形中线两份内置作品，保存对象之间的关联 |

## 界面组件

`src/ui/` 维护页面元素、交互状态和无障碍属性。样式放在 `src/styles/`，对象计算交给模型、几何和数学模块

| 文件                                                 | 职责                                                                |
| :--------------------------------------------------- | :------------------------------------------------------------------ |
| [ui.ts](../src/ui/ui.ts)                             | 创建主界面、工具按钮和图标，显示北京时间与应用版本                  |
| [tool-definitions.ts](../src/ui/tool-definitions.ts) | 集中定义分组工具的名称、模式和图标                                  |
| [tool-groups.ts](../src/ui/tool-groups.ts)           | 处理长按工具菜单、模式选择和菜单收起                                |
| [inspector.ts](../src/ui/inspector.ts)               | 显示画布和选中对象的属性，校验输入后修改模型                        |
| [object-manager.ts](../src/ui/object-manager.ts)     | 显示对象列表，提供选择、层级、锁定和隐藏按钮                        |
| [text-toolbar.ts](../src/ui/text-toolbar.ts)         | 创建文字选区上方的配置栏，处理字体菜单和对齐操作                    |
| [fonts.ts](../src/ui/fonts.ts)                       | 维护支持的本机字体列表，供属性面板和文字配置栏共用                  |
| [archive-picker.ts](../src/ui/archive-picker.ts)     | 显示存档选择菜单，同步当前存档与菜单位置                            |
| [menu-keyboard.ts](../src/ui/menu-keyboard.ts)       | 处理菜单中的方向键、Home 和 End 焦点移动                            |
| [math-dialogs.ts](../src/ui/math-dialogs.ts)         | 读取坐标点、函数和拟合输入，计算成功后一次性加入作品                |
| [description.ts](../src/ui/description.ts)           | 更新 Markdown 项目说明，使用 Marked 解析并由 DOMPurify 过滤预览内容 |
| [motion.ts](../src/ui/motion.ts)                     | 同步侧栏、按钮状态和画布布局，动画效果由 CSS 控制                   |
| [branding.ts](../src/ui/branding.ts)                 | 为界面标题和浏览器标签页设置共用图标                                |

## 文件与存档

| 文件                                                    | 职责                                                                  |
| :------------------------------------------------------ | :-------------------------------------------------------------------- |
| [document.ts](../src/storage/document.ts)               | 逐字段校验项目文件和 SVG 中的项目元数据，检查类型、数值范围及几何引用 |
| [archives.ts](../src/storage/archives.ts)               | 管理浏览器中的多份存档，处理新建、保存、打开和删除                    |
| [archive-content.ts](../src/storage/archive-content.ts) | 比较作品内容时统一随机编号，用于识别重复存档                          |
| [content.ts](../src/storage/content.ts)                 | 计算实际显示边界，保存内容范围和外侧留白，同时保留对象原坐标          |
| [files.ts](../src/storage/files.ts)                     | 打开项目，生成带项目元数据的 SVG，并下载项目、SVG 或 PNG              |

浏览器存档与导出文件是两个保存位置。自动保存和保存按钮写入浏览器存储；下载项目文件时，会保留图形、文字和几何关联，之后可以重新打开

## 样式文件

| 文件                                                   | 职责                                                 |
| :----------------------------------------------------- | :--------------------------------------------------- |
| [tokens.css](../src/styles/tokens.css)                 | 定义共用颜色、字体、间距和层级等样式参数             |
| [styles.css](../src/styles/styles.css)                 | 设置页面基础样式、工具栏、侧栏、按钮和对话框         |
| [workspace.css](../src/styles/workspace.css)           | 调整工作区布局、工具尺寸和不同屏幕宽度下的显示方式   |
| [motion.css](../src/styles/motion.css)                 | 定义面板、菜单和提示的过渡效果，适配减少动态效果设置 |
| [selects.css](../src/styles/selects.css)               | 设置选择控件的外观                                   |
| [text-toolbar.css](../src/styles/text-toolbar.css)     | 设置文字配置栏和字体菜单的布局                       |
| [archive-picker.css](../src/styles/archive-picker.css) | 设置存档选择栏和弹出选项的样式                       |
| [math-tools.css](../src/styles/math-tools.css)         | 设置数学工具输入区域和比例尺的样式                   |

## 配置与脚本

| 文件                                                   | 职责                                                     |
| :----------------------------------------------------- | :------------------------------------------------------- |
| [paths.ts](../config/paths.ts)                         | 集中维护构建、发布、测试输出目录和 Vite 配置路径         |
| [vite.config.ts](../config/vite.config.ts)             | 指定构建入口和输出目录，将页面打包为独立 HTML            |
| [playwright.config.ts](../config/playwright.config.ts) | 指定浏览器测试目录、输出目录和开发服务地址               |
| [prettier.json](../config/prettier.json)               | 设置缩进、行宽和代码格式                                 |
| [prettierignore](../config/prettierignore)             | 排除生成目录、依赖和本地约定文件等格式化目标             |
| [dev.ts](../scripts/dev.ts)                            | 启动开发服务，同时监听源码并重建离线文件                 |
| [copy-notices.ts](../scripts/copy-notices.ts)          | 将第三方声明和依赖许可原文复制到构建目录，并准备发布入口 |
| [package.ts](../scripts/package.ts)                    | 将构建文件、示例和许可证压缩为带版本号的 ZIP             |
| [build-examples.ts](../scripts/build-examples.ts)      | 根据内置模板生成示例项目文件，写入前校验作品格式         |
| [check-style.ts](../scripts/check-style.ts)            | 检查基础写法、函数说明、普通注释和 HTML 内联脚本         |

## 测试与文档

| 文件                                                                       | 职责                                           |
| :------------------------------------------------------------------------- | :--------------------------------------------- |
| [model.test.ts](../tests/model.test.ts)                                    | 验证模型、对象命令、存档和导出等逻辑           |
| [math.test.ts](../tests/math.test.ts)                                      | 验证坐标解析、函数、拟合和几何构造             |
| [snapping.test.ts](../tests/snapping.test.ts)                              | 验证吸附顺序与图形位置计算                     |
| [style.test.ts](../tests/style.test.ts)                                    | 验证风格检查器能识别禁止的写法和注释问题       |
| [editor.spec.ts](../tests/browser/editor.spec.ts)                          | 验证编辑器中的基本操作                         |
| [interaction.spec.ts](../tests/browser/interaction.spec.ts)                | 验证选择、拖动和变换等鼠标交互                 |
| [workspace.spec.ts](../tests/browser/workspace.spec.ts)                    | 验证工具栏、存档、对象管理、文字配置和几何操作 |
| [math.spec.ts](../tests/browser/math.spec.ts)                              | 验证数学工具输入、绘图、坐标轴和相关交互       |
| [offline.spec.ts](../tests/browser/offline.spec.ts)                        | 验证双击入口和离线编辑器                       |
| [helpers.ts](../tests/browser/helpers.ts)                                  | 提供浏览器测试共用的存档选择和输出路径函数     |
| [CHANGELOG.md](CHANGELOG.md)                                               | 记录各版本的功能变化与修复                     |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)                           | 记录第三方依赖来源、许可和署名                 |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)                               | 说明项目目录、文件职责和运行流程               |
| [workspace-empty.png](images/workspace-empty.png)                          | README 中的空白工作台截图                      |
| [course-flow.svgboard.json](../examples/course-flow.svgboard.json)         | 可以打开并继续编辑的流程图示例                 |
| [triangle-median.svgboard.json](../examples/triangle-median.svgboard.json) | 保留几何关联的三角形中线示例                   |

## 一次编辑如何完成

1. `main.ts` 初始化界面、存档和 `BoardCanvas`，将当前作品交给画布显示
2. 用户点击按钮、修改属性或操作画布后，对应界面模块或画布模块将变化写入作品模型
3. 几何与数学模块根据来源对象更新关联结果，画布同步显示新的图形和标签
4. 应用记录历史快照并安排自动保存，保存时计算内容范围、校验作品，再写入浏览器存储
5. 导出时，文件模块根据作品模型生成 SVG；导出 PNG 时，再将 SVG 绘制到离屏画布

## 修改功能时从哪里开始

| 修改内容             | 主要入口                                                                                  |
| :------------------- | :---------------------------------------------------------------------------------------- |
| 新增工具或调整分组   | `ui/tool-definitions.ts`、`ui/ui.ts`、`canvas/canvas.ts`                                  |
| 修改拖动、平移或选择 | `canvas/canvas.ts` 及对应控制点、命中处理文件                                             |
| 修改几何联动或吸附   | `geometry/geometry.ts`、`geometry/snapping.ts`                                            |
| 修改函数或拟合       | `math/expressions.ts`、`math/plots.ts`、`ui/math-dialogs.ts`                              |
| 新增对象属性         | `core/types.ts`、`core/model.ts`、`ui/inspector.ts`、`storage/document.ts` 和对应显示代码 |
| 修改存档或导出       | `storage/archives.ts`、`storage/content.ts`、`storage/files.ts`                           |
| 修改页面外观或动画   | `styles/` 中对应文件                                                                      |

上表中的源码路径均相对于 `src/`。跨模块共用的限制在同一处维护，避免界面允许输入的内容无法通过文件校验
