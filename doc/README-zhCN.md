# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](../LICENSE)

**Zotero Evidence** 是一个由 AI 驱动的 [Zotero](https://www.zotero.org/) 插件，把 Zotero 文献库变成系统性文献综述（Systematic Review）的工作台。它按照 PRISMA 风格的标准流程——导入去重、标题/摘要筛选、全文筛选、证据提取（编码）——推进每一条文献，AI 在每个决策点提供辅助建议，最终决定始终由人工确认。

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

## 工作流程

```
导入去重 → 标题/摘要筛选 (TA-Screening) → 全文筛选 (FT-Screening) → 证据编码 (Extract Coding) → 导出
```

每个阶段都会把文献在项目自动创建的固定 Collection 结构（`Sources`、`Screen Queue`、`TA-Include/Exclude/Unclear`、`FT-Queue`、`FT-Include/Exclude/Unavailable`、`Coding`）之间流转，因此每条文献当前所处的状态在 Zotero 文献库面板中一目了然。

## 功能特性

### 项目与导入

- **新建 Evidence 项目**：一步创建项目所需的完整 Collection 结构。
- **导入文献**：通过 Zotero 自带的翻译器导入 RIS / BibTeX / MEDLINE / PubMed XML 等检索结果文件，存入项目的 `Sources` 集合。查重采用 DOI 优先策略，无 DOI 时回退到"标题+作者+年份"匹配，重复文献会被合并而非重复添加。支持安全的增量导入：已经筛选或编码过的文献保持原状态不受影响，只有真正的新文献会重新进入流程。
- **导入提取文献**：适用于已经在别处完成筛选的文献——直接导入 `Coding` 集合，跳过 TA/FT 筛选环节。

### 标题/摘要筛选 (TA-Screening)

- AI 依据项目设定的研究问题与纳入/排除标准，对每条文献给出 **纳入 / 排除 / 不确定** 判断，并在标题摘要旁展示判断理由。
- 一键确认任意决定；一键撤销可将文献退回待筛选队列。
- 支持在选中多条文献后，通过右键菜单进行批量 **运行 AI 判断** 与 **批量确认 AI 建议**。

### 全文筛选 (FT-Screening)

- 筛选操作在 **PDF 阅读器侧边栏** 中完成——边读全文边做决定。库视图保留一个只读摘要（含撤销），无需打开 PDF 也能快速查看筛选结果。
- 当 AI 建议排除时，会从项目配置的排除标准中 **逐字挑选** 最匹配的一条，人工只需审核确认，无需手动选择理由。
- 自动检测条目是否已附加 PDF；无法获取全文的文献可标记为 **不可用**。支持通过右键菜单批量操作：仅将选中条目中尚未检测到 PDF 的文献标记为不可用。
- AI 定位到的支持性原文引用，以及人工自己标注的高亮，都可以关联为该决定的证据依据，并以固定颜色自动高亮，便于后续复核。

### 证据编码 (Extract Coding)

- 为项目定义 **Codebook（编码手册）**：分类型 / 数值型 / 文本型变量，可配置可选值、是否必填/允许多值、备注，以及给 AI 的提取提示。支持从 CSV 导入 Codebook（一键下载模板）、逐个添加变量，也可以随时编辑已有变量的全部信息。
- AI 阅读全文，生成建议的 `变量 = 值` 映射，每条建议都附带原文引用，并尽可能在 PDF 上自动定位高亮。
- 可逐条审核建议，也可批量采纳/拒绝；AI 遗漏的内容支持手动添加；已确认的记录可以撤销。
- 与全文筛选一致的阅读器/库视图分工：完整的交互式编辑器在 PDF 阅读器中，库视图展示只读的已确认证据摘要。

### 数据导出

- **导出 PRISMA 数据**：各阶段数量统计与排除理由分布，可直接用于绘制 PRISMA 流程图。
- **导出筛选决策日志**：每条文献的完整筛选决策审计记录。
- **导出编码数据**：全部已确认的变量/值映射结果。
- **筛选进度**：实时查看每个项目在各流程阶段的数量统计面板。

### AI Provider

支持接入任意兼容 OpenAI chat/completions 接口的服务商（自定义端点、模型、API Key），批量操作的并发数可配置。

## 快速上手

1. 在 Zotero 7 中安装插件（如果使用最新版 Zotero，可能需要 beta 版本）。
2. **文件 → AI Provider 设置…**，填入端点、模型和 API Key。
3. **文件 → 新建 Evidence 项目…**
4. **文件 → 导入文献…** 导入检索结果（若文献已在别处筛选完毕，使用 **导入提取文献…**）。
5. **文件 → 配置标题/摘要筛选标准…** 与 **配置全文筛选标准…**，设定研究问题及纳入/排除标准。
6. 依次处理 `Screen Queue` → `FT-Queue` → `Coding`：标题摘要阶段和库视图摘要在条目侧边栏完成，全文阶段和编码在 PDF 阅读器侧边栏完成。
7. 撰写综述报告时，使用 **导出 PRISMA 数据…** / **导出筛选决策日志…** / **导出编码数据…**。

## 开发

本插件基于 [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) 与 [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) 构建。

### 环境要求

1. 用于开发调试的 Zotero：<https://www.zotero.org/support/beta_builds>
2. [Node.js LTS 版本](https://nodejs.org/zh-cn/download) 与 [Git](https://git-scm.com/)

### 环境搭建

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # 设置 ZOTERO_PLUGIN_ZOTERO_BIN_PATH 及开发用 profile
npm install
```

### 常用命令

- `npm start` — 启动开发服务器：构建插件、启动加载了插件的 Zotero，并在 `src/**`、`addon/**` 文件变化时自动热重载。
- `npm test` — 在真实 Zotero 实例内运行测试套件。
- `npm run build` — 生产模式构建，产物位于 `.scaffold/build/`。
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint 检查/修复。
- `npm run release` — 升级版本号并发布（发布流程详见 [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold)）。

### 目录结构

```
src/
|-- hooks.ts                  # 生命周期钩子，File 菜单事件分发
|-- modules/
|   |-- project/              # 项目与 Collection 结构、项目上下文
|   |-- import/               # Zotero.Translate.Import 封装
|   |-- dedup/                # DOI 优先 / 标题+作者+年份 查重
|   |-- screening/            # TA/FT 筛选：AI 判断、筛选标准、决策记录
|   |-- coding/                # Codebook 与证据编码服务
|   |-- pdf/                  # PDF 文本提取、原文定位、高亮创建
|   |-- ai/                   # AI Provider 配置与 chat completion 调用
|   |-- export/               # PRISMA / 筛选日志 / 编码数据导出
|   |-- db/                   # SQLite 表结构与迁移
|   `-- ui/                   # 条目面板（Screen Queue / FT-Queue / Coding）与各类对话框
addon/                        # manifest、locale、静态资源
test/                         # Mocha 测试套件，通过 `npm test` 在 Zotero 内运行
```

### 参考资料

- [📖 Zotero 7 插件开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [📖 插件开发文档（中文，尚不完善）](https://zotero-chinese.com/plugin-dev-guide/)
- [🛠️ Zotero 插件工具包](https://github.com/windingwind/zotero-plugin-toolkit) | [API 文档](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
- [🛠️ Zotero 插件开发脚手架](https://github.com/northword/zotero-plugin-scaffold)
- [ℹ️ Zotero 类型定义](https://github.com/windingwind/zotero-types)
- [📜 Zotero 源代码](https://github.com/zotero/zotero)

## 许可协议

AGPL-3.0-or-later，详见 [LICENSE](../LICENSE)。不提供任何保证，请遵守你所在地区的法律。
