# Personal Work Terminal · 个人工作台

一个可自行部署的**单用户工作台**，将分散在不同组织、文档和网站中的工作集中管理：按事项安排任务，查看自己的日程，整理报销材料，在本地记录每位成员的工作与时长，再手动标记是否已填入外部表格。

采用 Next.js、React、TypeScript 与文件存储，支持本机运行和云端部署。初始只有通用部门模板，成员、任务、材料与服务连接由使用者自行添加。

## 能做什么

| 模块 | 功能 |
| --- | --- |
| 事务与任务 | 大事项卡片、子任务、完成进度、执行成员、审批与跟进；点击事项再展开详情 |
| 我的日程 | 首页日程和月历只展示本人执行或明确负责、审核的工作；其他工作保留为记录 |
| 成员与部门 | 多组织、部门、职务配置；成员信息、圆形头像上传和拖动排序 |
| 报销材料 | 批量管理、材料识别与自动填入、关联事项；区分经办人与报销人，记录打车路线和同行人 |
| 材料导出 | 单笔或整个事项打包，生成 PDF、Excel 与 ZIP；支持收支明细格式和繁体材料命名 |
| 出工与绩效 | 出工、实际时长、志愿时确认与录入状态、原始绩效计次；原表分值另作来源参考 |
| 本地工作记录 | 按成员记录工作、日期、当次时长及志愿时／绩效，手动标记是否已同步到表格，可筛选并导出明细 |
| 其他连接 | iCloud 日历双向手动同步、GitHub 仓库动态、可选 DeepSeek 任务辅助，以及可配置的设备与网站入口 |
| 账号与访问 | 单主账号登录、受信设备、扫码授权及通行密钥；连接凭据加密保存 |

界面采用 macOS 风格的中性色、分层卡片和玻璃效果，编辑窗口在当前页面打开。

## 快速启动

准备 **Node.js 24** 和 **pnpm 11.25.0**：

```sh
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 [http://localhost:3939](http://localhost:3939)，首次在本机创建主账号，再配置部门、本人身份与所需服务。开发时可使用 `pnpm dev`。

应用默认监听本机回环地址。需要局域网访问时使用 `pnpm start:lan`；云端使用反向代理和 HTTPS。通行密钥还取决于浏览器、安全来源及 RP ID，建议使用 localhost 或 HTTPS 域名。

## 配置与数据

需要环境变量时，将 [`.env.example`](.env.example) 复制为 `.env`；Windows PowerShell 可使用 `Copy-Item .env.example .env`。

| 配置 | 用途 |
| --- | --- |
| `WORKBENCH_DATA_DIR` | 私人数据目录，默认 `./data` |
| `WORKBENCH_USERNAME` / `WORKBENCH_PASSWORD` | 云端首次启动主账号；后续通过账号设置修改 |
| `WORKBENCH_PUBLIC_URL` | 对外 HTTPS 地址，供扫码和来源校验使用 |
| `WORKBENCH_LOCK_SETUP` | 云端关闭网页初始化，账号文件缺失时拒绝提供服务 |
| `WORKBENCH_OCR_PYTHON` | 可选本地 RapidOCR Python 环境的绝对路径 |
| `EQUIPMENT_BASE_URL` | 可选设备服务地址，需要兼容现有适配器 |
| `DEVICE_LOGIN_HOST` / `NEWS_LOGIN_HOST` | 登录助手允许填写凭据的精确主机名 |

成员、任务、日程、报销附件、连接授权和登录数据存放在私人数据目录。请备份整个目录；如果将加密密钥放在目录之外，还需单独备份该密钥。恢复时需要数据与对应密钥。

文件存储按**单实例、单写入进程**使用，不应让多个应用实例同时写同一个数据目录。

## 连接原有服务

- **本人身份**：在设置中选择不同部门里的本人身份，并补充姓名别名，供个人日程筛选使用。
- **iCloud、GitHub、AI**：按需在各自页面配置。日历手动选择读取范围与发布项目；AI 只在调用相关辅助功能时使用。
- **设备与网站入口**：通过已登录的工作入口导入接口配置资源。设备服务需要适配接口；登录助手需要同步配置精确目标域名，参见 [`browser-helper/README.txt`](browser-helper/README.txt)。

表格连接及自动读写模块已移除。工作、时长与填表状态仅保存在工作台的数据目录；“已同步”由使用者在手动填表后勾选，修改工作内容或时长后自动回到“未同步”。历史资料缺少的日期和时长保留空白。其他第三方连接仍需使用者自己的账号及权限。

## 报销识别

支持 PDF、常见图片、OFD/XML、TXT/Markdown、CSV/JSON、Word 和 Excel。费用日期优先使用行程或支付资料，开票日期单独保存。识别结果需核对原件，不提供发票验真。

默认可使用 Tesseract；可选安装本地 RapidOCR，详见[材料识别说明](docs/reimbursement-recognition.md)。Docker 默认镜像未安装 Python，使用 RapidOCR 时需扩展镜像并配置容器内的 Python 路径。部分格式读取也依赖该可选环境。

## Docker 部署

在 `.env` 配置主账号和对外地址，然后运行：

```sh
docker compose up -d --build
```

Compose 只将端口映射到宿主机 `127.0.0.1:3939`，业务数据保存在独立命名卷 `workbench_data`。对外访问需反向代理。只有在代理可靠覆盖来源 IP 请求头时才启用 `WORKBENCH_TRUST_PROXY`，详见[安全说明](SECURITY.md)。

## 开发与验证

先执行 `pnpm build`，再按改动范围运行检查：

```sh
pnpm typecheck
node scripts/check-local-work.cjs
node scripts/check-local-work.cjs
node scripts/check-local-work.cjs
node scripts/check-calendar-entries.mjs
node scripts/check-volunteer-ledger.mjs
node scripts/smoke-test.mjs
node scripts/check-security.mjs
```

测试使用隔离目录、虚构样例；本地工作记录测试禁止网络访问。`scripts/` 还提供报销识别、导出、账号和通行密钥的专项检查；检查名称及用途可直接查看相应脚本。

## 项目结构与说明

```text
app/             页面、样式与 API 入口
components/      工作台、表单、成员、日程和报销界面
lib/             业务规则、服务适配、识别与导出
browser-helper/  原站登录助手模板
scripts/         检查脚本与可选 OCR 工作进程
docs/           功能与适配说明
```

- [本地工作记录](docs/local-work-records.md)
- [本地工作记录](docs/local-work-records.md)
- [本地工作记录](docs/local-work-records.md)
- [个人日程筛选](docs/personal-calendar.md)
- [报销流程](docs/reimbursement.md)、[材料识别](docs/reimbursement-recognition.md)、[导出格式](docs/reimbursement-export-format.md)
- [安全与部署边界](SECURITY.md)

此仓库仅发布功能源码和虚构示例，不包含个人名单、账号密码、API 密钥、原工作网站、表格分享链接、业务数据库、票据附件或私人部署配置。缺省服务保持未连接；私人导入、诊断和文档制作工具不属于公开运行代码。
