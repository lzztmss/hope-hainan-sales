# 海南联通 FTTR 心连心销售报价系统 Linux 安装部署手册

## 1. 交付范围

本包是完整的全栈私有化部署，包含：

- 手机/电脑自适应销售系统 Web 前端；
- Fastify API、登录与权限、客户/报价/订单/退单/提成/报表数据；
- PostgreSQL 16 持久数据库；
- 版本化迁移、初始管理员和默认提成规则初始化；
- 加密备份、SHA-256 校验、先 staging 恢复和生产切换；
- 安装、升级、验证及故障排查脚本。

本版不是旧的“无登录静态报价页”。生产数据会保存到 PostgreSQL，必须纳入正式备份和隐私数据管理。

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
                         +---- PostgreSQL:5432（internal 网络）
```

默认安全设置：

- Web 仅绑定主机 `127.0.0.1:8080`，不直接暴露 HTTP 给公网；
- PostgreSQL **没有主机端口映射**，仅 API/运维容器可访问；
- 敏感 API 禁止缓存，Nginx 配置 CSP、`nosniff`、禁止 iframe 和权限策略；
- 应用与 Web 容器使用只读文件系统、临时 tmpfs、去除 Linux capabilities；
- 真实密码、PII 密钥和备份口令只放在服务器 `.env`，不在镜像或 ZIP 中。

## 3. 服务器要求

推荐生产起步配置：2 vCPU、4 GB 内存、40 GB SSD（数据增长后另行扩容）。支持 x86_64 或 ARM64 Linux，建议 Ubuntu 22.04/24.04、Debian 12、Rocky/AlmaLinux 9。

需要：

- Docker Engine 24 或更高；
- `docker compose` v2，或兼容的 `docker-compose` 1.29+；
- `openssl`、`curl`、`unzip`、`sha256sum`（macOS 打包机可用 `shasum`）；
- 可访问已配置的镜像/软件包源，首次构建需要拉取固定版本基础镜像和 pnpm 依赖。

安装 Docker 后先检查：

```bash
docker --version
docker compose version || docker-compose version
openssl version
```

## 4. 验证安装包

把 ZIP 和同名 `.sha256` 上传到服务器，在解压前验证：

```bash
sha256sum -c '海南联通FTTR心连心销售报价系统_Linux部署包_v2.0.1-20260802.zip.sha256'
unzip '海南联通FTTR心连心销售报价系统_Linux部署包_v2.0.1-20260802.zip'
cd hainan-fttr-heartlink-sales-v2.0.1-20260802
sha256sum -c CHECKSUMS.sha256
```

任一校验失败都应停止，不要继续安装。

## 5. 创建生产密钥

推荐让脚本生成全部随机密钥。`APP_ORIGIN` 必须是最终公网 HTTPS 地址，不能带路径：

```bash
bash deploy/linux/scripts/install-v2.sh \
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
openssl rand -hex 32     # 可用于数据库密码和备份口令
vi deploy/linux/.env
bash deploy/linux/scripts/install-v2.sh --check-only
```

强制规则包括：正式 `https://` 来源、数据库随机密码至少 24 位、两个 PII 密钥各自解码为 32 字节且不相同、管理员密码至少 16 位并含大小写和数字、备份口令至少 24 位。占位值和常见弱密码会被拒绝。

## 6. 首次安装

```bash
bash deploy/linux/scripts/install-v2.sh --yes
```

脚本顺序固定为：

1. 校验 ZIP 内部 SHA-256 和 `.env` 安全要求；
2. 用固定版本基础镜像构建 `api`、`web`、`backup`；
3. 只启动 PostgreSQL 并等待健康；
4. **先运行全部版本化迁移**；
5. 初始化首个管理员和默认提成规则；
6. 迁移与初始化成功后才启动 API；
7. API 健康后启动 Web；
8. 验证首页、API、安全响应头、数据库和迁移记录；
9. 把应用版本和 schema 版本记录到 `deploy/linux/state/release-history.log`。

查看状态和日志：

```bash
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink ps
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink logs --tail=200 api web postgres
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

必须传递 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto` 和请求 ID。`X-Forwarded-Proto https` 对 Secure Cookie、审计和跳转判断很重要。证书和私钥不属于安装包，必须由公司证书系统或 ACME 单独管理。

防火墙只放行 80/443；不要放行 5432、3001 或默认内部 8080。安装后从公网验证 HTTP 自动跳 HTTPS，浏览器地址栏证书可信，且：

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
bash deploy/linux/scripts/verify-v2.sh http://127.0.0.1:8080
```

## 9. 加密备份

手工备份：

```bash
bash deploy/linux/scripts/backup.sh
```

输出目录默认为 `deploy/linux/backups/`，每次产生：

```text
hainan-fttr-YYYYMMDDTHHMMSS.dump.enc
hainan-fttr-YYYYMMDDTHHMMSS.dump.enc.sha256
hainan-fttr-YYYYMMDDTHHMMSS.dump.enc.meta
```

`.dump.enc` 是 PostgreSQL custom dump 经 AES-256-CBC + PBKDF2（200,000 次）加密后的文件；`.sha256` 校验密文传输完整性；`.meta` 记录格式、应用版本和算法，不含密钥。脚本不会把未加密 dump 写入宿主机磁盘。

建议每天定时并把三件套同步到独立、访问受控的异地存储。示例（每天 02:20）：

```cron
20 2 * * * cd /opt/hainan-fttr-heartlink-sales-v2.0.1-20260802 && bash deploy/linux/scripts/backup.sh >> deploy/linux/state/backup.log 2>&1
```

本机保留天数由 `BACKUP_RETENTION_DAYS` 控制。**本机备份不等于灾备**；至少每季度执行一次真实恢复演练。

## 10. 恢复演练（默认安全）

恢复脚本默认只创建全新 staging 数据库，不会覆盖生产：

```bash
bash deploy/linux/scripts/restore.sh \
  --backup deploy/linux/backups/hainan-fttr-20260802T120000.dump.enc
```

它会先验证 SHA-256 和解密口令，再创建全新空库、执行 `pg_restore`，并检查：

- 一个报价不会重复生成多个订单；
- 订单销售归属比例合计为 10000 基点；
- 提成快照与计提流水相符；
- 完成退单数量不超过销售数量；
- 结算流水没有重复纳入；
- 订单关键不可变快照完整。

若 staging 名已存在，脚本直接拒绝，绝不静默覆盖。

## 11. 生产恢复切换（仅灾难场景）

先完成第 10 节的 staging 恢复和业务抽查。确认窗口后必须精确输入生产库名并二次确认：

```bash
bash deploy/linux/scripts/restore.sh \
  --backup deploy/linux/backups/hainan-fttr-20260802T120000.dump.enc \
  --staging-database hainan_fttr_restore_verified \
  --confirm-production-overwrite hainan_fttr
```

脚本会停止 Web/API，重新验证 staging，把旧生产库重命名保留为 `hainan_fttr_before_restore_时间戳`，再把 staging 切换为生产库，随后重启和验收。旧库不会自动删除。非交互自动化还必须显式增加 `--yes`。

不要手工把 `pg_restore --clean` 指向生产库。不要在没有当前加密备份、变更单和现场负责人的情况下执行生产切换。

## 12. 升级与回退边界

解压新版到新的独立目录，把旧目录 `.env` 安全复制到新版 `deploy/linux/.env`，修改 `APP_VERSION` 为新版，并运行：

```bash
chmod 600 deploy/linux/.env
bash deploy/linux/scripts/upgrade-v2.sh --yes
```

升级先做加密备份，再构建带新版本 tag 的镜像并执行向上迁移。脚本不会自动执行 down-migration。

应用回退仅在新版数据库迁移经过评审、确认对旧应用**向后兼容**时允许：回到旧版解压目录，用旧 `.env` 和旧镜像 tag 重新启动 API/Web。若迁移不向后兼容，不得启动旧应用；应使用已验证备份按第 10–11 节恢复。数据库回退属于数据恢复，不是普通应用回滚。

每次版本变更均查看：

```bash
tail -n 20 deploy/linux/state/release-history.log
```

## 13. 密钥与数据管理

- `.env`、备份口令和 PII 密钥需要纳入公司秘密管理与最小权限；
- PII 加密密钥丢失会导致客户数据无法解密，必须单独离线托管；
- 备份口令丢失会导致历史备份不可恢复；
- 不要随意轮换 PII 密钥。轮换必须有专门的数据重加密方案和双人复核；
- 首次管理员完成改密后，可把 `.env` 中 bootstrap 密码替换为另一个强随机值；初始化脚本不会重置已存在管理员密码；
- `.env` 权限保持 `0600`，部署目录、备份目录和日志仅允许运维账号访问；
- 不得把客户真实资料、数据库文件、明文 CSV 或备份复制进安装 ZIP。

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

**严禁**在生产运行 `docker compose down -v`、`docker volume rm`、手工删除 `/var/lib/postgresql/data` 或编辑迁移记录。

## 15. 故障排查

### `APP_ORIGIN` 或 Cookie 问题

确认 `.env` 是浏览器实际访问的完整 HTTPS 源（协议 + 域名 + 可选端口，不带路径），外层代理传递 `X-Forwarded-Proto https`，浏览器没有通过 IP/HTTP 访问。

### API 不启动

```bash
docker compose --env-file deploy/linux/.env -f deploy/linux/docker-compose.yml -p hainan-fttr-heartlink logs migrate seed api
```

API 故意依赖 `migrate` 和 `seed` 成功。不要绕开依赖强行启动；修复迁移/密钥/数据库错误后重新执行安装或升级脚本。

### 备份失败

检查备份目录空间和权限、`BACKUP_ENCRYPTION_PASSPHRASE` 是否仍满足要求、PostgreSQL 是否健康。不要为了“先备份出来”而改成明文 dump。

### 恢复报 staging 已存在

这是安全保护。使用新的 staging 名；旧 staging 应先由工程师确认用途后人工处理，脚本不会自动删除数据库。

### 镜像构建无法下载

配置公司 Docker/npm 代理或在可联网的受控构建机预构建同架构镜像后导入。不要把仓库密码写入 Dockerfile、Compose 或 `.env.example`。

## 16. 交付验收清单

- [ ] ZIP 外部和内部 SHA-256 均通过；
- [ ] `.env` 权限 0600，密钥已进入密码管理器；
- [ ] PostgreSQL 没有主机端口，防火墙只开 80/443；
- [ ] 公网 HTTPS 证书可信，HTTP 强制跳转；
- [ ] `verify-v2.sh` 通过；
- [ ] 管理员已改初始密码；
- [ ] 销售/主管/管理员权限抽查通过；
- [ ] 报价打印、订单激活、退单、提成和报表业务旅程通过；
- [ ] 加密备份已复制到异地；
- [ ] 一次 staging 恢复和一致性检查通过；
- [ ] 升级/恢复负责人、维护窗口和告警联系方式已归档。
