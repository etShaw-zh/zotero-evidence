# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![CI](https://img.shields.io/github/actions/workflow/status/etShaw-zh/zotero-evidence/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/etShaw-zh/zotero-evidence/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/etShaw-zh/zotero-evidence?style=flat-square)](https://github.com/etShaw-zh/zotero-evidence/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](../LICENSE)

**Zotero Evidence** 是一个 AI 驱动的 [Zotero](https://www.zotero.org/) 插件，把文献库变成系统性文献综述工作台：导入去重 → 标题/摘要筛选 → 全文筛选 → 证据编码 → 主题综合 → 导出，AI 在每一步提供辅助建议，最终决定始终由人工确认。

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

## 工作流程

每个阶段都会把文献流转到项目自动创建的固定 Collection 中，状态在 Zotero 文献库面板中一目了然：

```
1. Sources → 2. TA-Screen Queue → 3. TA-Screening Results
  → 4. FT-Screen Queue → 5. FT-Screening Results → 6. Extract Coding
```

## 功能特性

- **导入与去重** — 支持 RIS / BibTeX / MEDLINE / PubMed XML（通过 Zotero 自带翻译器）；DOI 优先查重，回退到标题+作者+年份；安全的增量导入，不影响已筛选文献。
- **标题/摘要筛选** — AI 在条目面板中给出纳入/排除/不确定建议及理由；一键确认/撤销，支持批量操作。
- **全文筛选** — 在 PDF 阅读器侧边栏完成；AI 从排除标准中逐字挑选理由，并将支持性原文定位为高亮。
- **证据编码** — 定义分类/数值/文本型 Codebook 变量，AI 提出 `变量 = 值` 映射，附原文引用与自动定位的高亮。
- **主题综合** — 一键将某变量的全部已确认证据归并为 AI 生成的主题，项目范围内可见。
- **数据导出** — PRISMA 流程数据、筛选决策日志、编码数据、主题分析数据，可直接用于撰写综述。
- **AI Provider** — 接入任意兼容 OpenAI 接口的服务商（自定义端点/模型/API Key），批量并发数可配置。

## 快速上手

1. 在 Zotero 7 中安装插件。
2. **文件 → AI Provider 设置…**：填入端点、模型、API Key。
3. **文件 → 新建 Evidence 项目…**，然后 **导入文献…**。
4. **文件 → 配置标题/摘要 / 全文筛选标准…**。
5. 依次处理 `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`。
6. 撰写综述时使用 **文件 → 主题综合分析…** 与 **导出…** 菜单。

## 开发

基于 [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) 与 [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) 构建。

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # 设置 ZOTERO_PLUGIN_ZOTERO_BIN_PATH 及开发用 profile
npm install
```

- `npm start` — 启动开发服务器，支持热重载
- `npm test` — 在真实 Zotero 实例内运行测试套件
- `npm run build` — 生产构建（产物位于 `.scaffold/build/`）
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint
- `npm run release` — 升级版本号并发布

```
src/
|-- hooks.ts        # 生命周期钩子，File 菜单分发
|-- modules/
|   |-- project/    # 项目与 Collection 结构
|   |-- import/     # Zotero.Translate.Import 封装
|   |-- dedup/      # DOI 优先 / 标题+作者+年份 查重
|   |-- screening/  # TA/FT 筛选：AI 判断、标准、决策
|   |-- coding/     # Codebook 与证据编码服务
|   |-- pdf/        # 文本提取、原文定位、高亮创建
|   |-- ai/         # AI Provider 配置与 chat completion
|   |-- export/     # PRISMA / 筛选日志 / 编码数据导出
|   |-- db/         # SQLite 表结构与迁移
|   `-- ui/         # 条目面板与各类对话框
addon/              # manifest、locale、静态资源
test/               # Mocha 测试套件，通过 `npm test` 在 Zotero 内运行
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
