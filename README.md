# 个人工作台

可自行部署的单用户工作台，采用 Next.js、React、TypeScript 与本地文件存储。

## 功能

- 可配置组织、部门、职务及成员，支持头像与排序。
- 事务与子任务、审核、跟进、日历、出工、志愿时与原始绩效计次。
- 报销材料本机识别、自动填入、重复检测、PDF / Excel / ZIP 整理。
- 主账号、受信设备及通行密钥。
- 可选 iCloud 日历、GitHub、DeepSeek、设备管理与外部工作入口连接。

## 启动

需要 Node.js 24 与 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 http://localhost:3939，首次创建自己的主账号。在设置中编辑部门与个人偏好。初始仅提供通用部门模板，没有成员、任务、日程、票据或连接账号。

## 配置

复制 .env.example 为 .env 后按需填写。凭据在运行时配置，不应提交到版本库。运行数据保存在 data/，包括主账号、加密凭据、日程与附件，请自行备份并保护此目录。

设备适配器需要 EQUIPMENT_BASE_URL，目标服务须兼容适配器中的接口。DEVICE_LOGIN_HOST 与 NEWS_LOGIN_HOST 是登录助手的精确域名白名单，不包含协议和路径。登录助手仅为功能模板，需同步修改 browser-helper 中的占位域名才能使用。

工作入口通过 POST /api/workspace/import 配置，包含 resources 数组（id、title、url、category、organization）。预留 ID：device-admin、news-review、library-reservation。API 需要已登录且符合来源检查。设备和图书馆未配置时不连接外部工作站。

iCloud、GitHub 和 AI 连接由使用者自行添加。未配置时不读取原使用者的任何服务。第三方平台的通用 API 地址属于功能实现，不附带账户。

## Docker

设置 .env 中的 WORKBENCH_USERNAME、WORKBENCH_PASSWORD 后运行 docker compose up -d --build。云端请配置 HTTPS 与 WORKBENCH_PUBLIC_URL。

## 验证

```sh
pnpm typecheck
node scripts/smoke-test.mjs
node scripts/check-recognition.mjs
```

测试仅生成虚构样例并使用隔离数据目录，不包含真实名单、发票或密码。扫描件 OCR 每份 PDF 最多处理三页，识别结果须核对；不完整的金额不会作为整份金额自动填入。

## 源码范围

此仓库为重新初始化的功能副本。没有原项目的数据库、附件、导入文件、运行日志、截图、服务器部署信息、真实组织资料或历史提交。所有默认组织均为通用示例，工作网站须自行配置。
