# 海南联通 FTTR 心连心销售报价系统 Linux 安装部署手册

## 1. 部署范围

本仓库包含完整的全栈私有化部署配置：

- 手机/电脑自适应销售系统 Web 前端；
- Fastify API、登录与权限、客户/报价/订单/退单/提成/报表数据；
- SQLite 持久数据库（单 API 实例）；
- 首次数据库初始化、初始管理员和默认提成规则初始化；
- SQLite 在线一致性备份、SHA-256 校验和安全恢复；
- 安装、升级、验证及故障排查脚本。

生产数据保存在 SQLite 持久化卷中，必须纳入正式备份和隐私数据管理。

## 2. 安全拓扑

```text
公网用户
    |
    | HTTPS :443（公司网关/主机 Nginx/Caddy/云负载均衡）
    v
127.0.0.1:8080  Web Nginx 容器
    |
    +---- /api/* ---> API:3001（Docker 内网）
                         |
                         +---- SQLite: /app/data/app.sqlite（持久化卷）
```

默认安全设置：

- Web 仅绑定主机 `127.0.0.1:8080`，不直接暴露 HTTP 给公网；
- SQLite 数据卷不映射为公网端口，仅 API/迁移/备份容器挂载；
- 敏感 API 禁止缓存，Nginx 配置 CSP、`nosniff`、禁止 iframe 和权限策略；
- 应用与 Web 容器使用只读文件系统、临时 tmpfs、去除 Linux capabilities；
- 真实密码和 PII 密钥只放在服务器 `.env`，不得写入镜像或提交到 Git 仓库。

## 3. 服务器要求

推荐生产起步配置：2 vCPU、4 GB 内存、40 GB SSD（数据增长后另行扩容）。支持 x86_64 或 ARM64 Linux，建议 Ubuntu 22.04/24.04、Debian 12、Rocky/AlmaLinux 9。

需要：

- Docker Engine 24 或更高；
- `docker compose` v2，或兼容的 `docker-compose` 1.29+；
- Git、`openssl` 和 `curl`；
- 可访问已配置的镜像/软件包源，首次构建需要拉取固定版本基础镜像和 pnpm 依赖。

安装 Docker 后先检查：

```bash
docker --version
docker compose version || docker-compose version
openssl version
git --version
```

## 4. 获取源码

从 Git 仓库获取源码，并检出准备部署的分支、标签或提交：

```bash
git clone <仓库地址> hope-hainan-sales
cd hope-hainan-sales
git status --short --branch
```

生产部署前，确认当前提交已经通过评审和测试，并且工作树没有未提交改动。

## 5. 创建生产密钥

推荐让脚本生成全部随机密钥。`APP_ORIGIN` 必须是最终公网 HTTPS 地址，不能带路径：

```bash
bash deploy/linux/scripts/install.sh \
  --generate-env \
  --app-origin https://quote.example.com \
  --check-only
```

脚本会创建 `deploy/linux/.env`（权限 `0600`），并在终端显示一次初始管理员密码。请立即放入公司密码管理器，严禁通过普通群聊、工单正文或邮件明文传播。

也可手工配置：

```bash
cp deploy/linux/.env.example deploy/linux/.env
chmod 600 deploy/linux/.env
openssl rand -base64 32  # 分别生成两个不同的 PII 密钥
vi deploy/linux/.env
bash deploy/linux/scripts/install.sh --check-only
```

强制规则包括：正式 `https://` 来源、两个 PII 密钥各自解码为 32 字节且不相同、管理员密码至少 16 位并含大小写和数字。占位值和常见弱密码会被拒绝。

## 6. 首次安装

```bash
bash deploy/linux/scripts/install.sh --yes
```

脚本顺序固定为：

1. 校验 `.env` 安全要求和 Compose 配置；
2. 用固定版本基础镜像构建 `api`、`web`；
3. 创建 SQLite 持久化卷；
4. 初始化当前版本的数据库结构；
5. 初始化首个管理员和默认提成规则；
6. 迁移与初始化成功后才启动 API；
7. API 健康后启动 Web；
8. 验证首页、API、安全响应头、数据库和迁移记录；
9. 把应用版本和 schema 版本记录到 `deploy/linux/state/release-history.log`。

查看状态和日志：

```bash
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink ps
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink logs --tail=200 api web
```

若服务器使用旧命令，把 `docker compose` 换成 `docker-compose`；所有交付脚本会自动检测两者。

## 7. 必须配置 HTTPS 反向代理

容器默认只监听 `127.0.0.1:8080`。正式公网不得把它改成 `0.0.0.0` 后直接使用明文 HTTP，应由公司网关、云负载均衡、Caddy 或主机 Nginx 终止 TLS。

主机 Nginx 示例：

```nginx
server {
    listen 80;
    server_name quote.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name quote.example.com;

    ssl_certificate     /etc/letsencrypt/live/quote.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quote.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

若服务器根路径已由其他系统占用，可改为子路径部署。部署环境填写：

```dotenv
APP_ORIGIN=https://quote.example.com
APP_BASE_PATH=/hainan-sales/
```

主机 Nginx 使用带结尾斜杠的 `proxy_pass` 去除外层前缀：

```nginx
location ^~ /hainan-sales/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Request-ID $request_id;
}
```

前端资源、React 页面路由和 `/api` 请求都会自动带上 `APP_BASE_PATH`。不要把站内链接写成跳回服务器根目录的原生绝对地址。

必须传递 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto` 和请求 ID。`X-Forwarded-Proto https` 对 Secure Cookie、审计和跳转判断很重要。证书和私钥不得提交到 Git 仓库，必须由公司证书系统或 ACME 单独管理。

防火墙只放行 80/443；不要放行 3001 或默认内部 8080。安装后从公网验证 HTTP 自动跳 HTTPS，浏览器地址栏证书可信，且：

```bash
curl -I https://quote.example.com/
curl -i https://quote.example.com/api/health
```

## 8. 首次业务验收

1. 使用 `ADMIN001` 和生成的初始密码登录；
2. 系统要求修改密码时立即修改；
3. 在“营业厅与账号”创建一个测试营业厅、主管和销售员；
4. 管理员检查默认提成规则，复制草稿、模拟后再发布；
5. 销售员完成一个测试报价，打印确认并生成订单；
6. 激活订单后检查个人提成累计；
7. 主管检查本厅报表、退单审批和销售数据范围；
8. 管理员检查全局报表和审计日志；
9. 删除测试业务数据只能使用系统的软删除/退单流程，不要直接操作数据库。

本机自动检查：

```bash
bash deploy/linux/scripts/verify.sh http://127.0.0.1:8080
```

## 9. SQLite 备份

手工备份：

```bash
bash deploy/linux/scripts/backup.sh
```

输出目录默认为 `deploy/linux/backups/`，每次产生：

```text
app-YYYYMMDDTHHMMSSZ.sqlite
app-YYYYMMDDTHHMMSSZ.sqlite.sha256
```

备份通过 SQLite 在线备份接口生成一致性副本，完成后立即执行完整性检查并生成 SHA-256。当前备份文件未做应用层二次加密，备份目录必须限制访问，并建议同步到具备服务端加密和权限审计的异地存储。

建议每天定时，并把数据库副本及其 `.sha256` 文件同步到独立、访问受控的异地存储。示例（每天 02:20）：

```cron
20 2 * * * cd /opt/hope-hainan-sales && bash deploy/linux/scripts/backup.sh >> deploy/linux/state/backup.log 2>&1
```

本机保留天数由 `BACKUP_RETENTION_DAYS` 控制。**本机备份不等于灾备**；至少每季度执行一次真实恢复演练。

## 10. 恢复演练

恢复会短暂停止 Web/API，先验证 SHA-256 与 SQLite 完整性，再保留当前数据库副本并替换为备份：

```bash
bash deploy/linux/scripts/restore.sh \
  --backup deploy/linux/backups/app-20260812T120000Z.sqlite
```

脚本恢复成功后会重启服务并运行 Web、API、SQLite 完整性和迁移记录检查；原数据库以 `.before-restore-时间戳` 文件保留，不会自动删除。

## 11. 生产恢复边界

恢复属于生产数据替换操作，必须安排维护窗口并先确认备份文件来源。非交互执行需显式增加 `--yes`。禁止直接复制运行中的 WAL/SHM 文件代替在线备份，也禁止删除恢复前自动保留的原库，直到业务验收完成。

## 12. 升级与回退边界

升级前，确认工作树没有未提交改动。拉取已评审的目标版本，修改 `deploy/linux/.env` 中的 `APP_VERSION`，然后运行升级脚本：

```bash
git status --short --branch
git pull --ff-only
chmod 600 deploy/linux/.env
bash deploy/linux/scripts/upgrade.sh --yes
```

升级先做 SQLite 一致性备份，再构建带新版本 tag 的镜像并执行向上迁移。脚本不会自动执行 down-migration。

应用回退仅在新版数据库迁移经过评审、确认对旧应用**向后兼容**时允许：检出已验证的旧提交，并使用旧 `APP_VERSION` 对应的镜像重新启动 API/Web。若迁移不向后兼容，不得启动旧应用；应使用已验证备份按第 10–11 节恢复。数据库回退属于数据恢复，不是普通应用回滚。

每次版本变更均查看：

```bash
tail -n 20 deploy/linux/state/release-history.log
```

## 13. 密钥与数据管理

- `.env` 和 PII 密钥需要纳入公司秘密管理与最小权限；
- PII 加密密钥丢失会导致客户数据无法解密，必须单独离线托管；
- 不要随意轮换 PII 密钥。轮换必须有专门的数据重加密方案和双人复核；
- 首次管理员完成改密后，可把 `.env` 中 bootstrap 密码替换为另一个强随机值；初始化脚本不会重置已存在管理员密码；
- `.env` 权限保持 `0600`，部署目录、备份目录和日志仅允许运维账号访问；
- 不得把客户真实资料、数据库文件、明文 CSV 或备份提交到 Git 仓库。

## 14. 常用运维命令

```bash
# 状态
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink ps

# 近 200 行日志
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink logs --tail=200

# 只重启 API/Web
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink restart api web

# 停止应用（保留数据卷）
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink stop web api

# 重新启动
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink up -d api web
```

**严禁**在生产运行 `docker compose down -v`、`docker volume rm`、手工删除 SQLite 数据卷 或编辑迁移记录。

## 15. 故障排查

### `APP_ORIGIN` 或 Cookie 问题

确认 `.env` 是浏览器实际访问的完整 HTTPS 源（协议 + 域名 + 可选端口，不带路径），外层代理传递 `X-Forwarded-Proto https`，浏览器没有通过 IP/HTTP 访问。

### API 不启动

```bash
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink logs migrate seed api
```

API 故意依赖 `migrate` 和 `seed` 成功。不要绕开依赖强行启动；修复迁移/密钥/数据库错误后重新执行安装或升级脚本。

### 备份失败

检查备份目录空间和权限、SQLite 数据卷是否可读写，以及 API 容器能否访问 `/app/data/app.sqlite`。

### 恢复校验失败

停止恢复并检查 `.sha256` 是否与备份同目录、文件是否完整。不要绕过校验或手工覆盖生产数据库。

### 镜像构建无法下载

配置公司 Docker/npm 代理或在可联网的受控构建机预构建同架构镜像后导入。不要把仓库密码写入 Dockerfile、Compose 或 `.env.example`。

## 16. 交付验收清单

- [ ] 已记录部署使用的 Git 提交；
- [ ] `.env` 权限 0600，密钥已进入密码管理器；
- [ ] SQLite 数据卷未暴露为主机端口，防火墙只开 80/443；
- [ ] 公网 HTTPS 证书可信，HTTP 强制跳转；
- [ ] `verify.sh` 通过；
- [ ] 管理员已改初始密码；
- [ ] 销售/主管/管理员权限抽查通过；
- [ ] 报价打印、订单激活、退单、提成和报表业务旅程通过；
- [ ] SQLite 一致性备份已复制到权限受控的异地存储；
- [ ] 一次恢复演练和完整性检查通过；
- [ ] 升级/恢复负责人、维护窗口和告警联系方式已归档。
