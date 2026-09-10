# 海南联通 FTTR 心连心销售报价系统

本仓库包含 React Web 前端、Fastify API、SQLite 数据库迁移，以及 Linux 容器化部署配置。

## 开发命令

```bash
pnpm install
pnpm dev
# 初始化本地验收库并启动 Web/API
pnpm dev:test
pnpm test
pnpm build
```

本地 Web 默认使用 `http://127.0.0.1:5173`。运行 API 前，按部署文档配置所需环境变量和 SQLite 路径。

## 目录

- `web/`：React Web 前端、页面、组件和前端测试。
- `server/`：API、业务服务、数据访问和服务端测试。
- `shared/`：前后端共享的核价、提成和报表类型与规则。
- `drizzle-sqlite/`：SQLite 迁移。
- `deploy/linux/`：Docker Compose、Nginx 和安装维护脚本。
- `scripts/`：本地验收和维护工具。
- `docs/`：实施进度与集中验收文档。
- `public/`：Web 静态资源。

## 文档入口

- [Linux 安装部署](README_INSTALL.md)
- [开发与验收文档](docs/README.md)
- [核价验收清单](docs/核价验收清单.md)

生产部署前应检出经过确认的 Git 分支、标签或提交，并保持工作树干净。
