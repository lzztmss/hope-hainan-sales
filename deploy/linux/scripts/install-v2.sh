#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
CHECK_ONLY=0
GENERATE_ENV=0
ASSUME_YES=0
APP_ORIGIN_INPUT=""

usage() {
  cat <<'EOF'
用法：install-v2.sh [参数]

  --env-file FILE       指定密钥配置（默认 deploy/linux/.env）
  --generate-env        生成新 .env，需配合 --app-origin
  --app-origin URL      公网 HTTPS 地址，例如 https://quote.example.com
  --check-only          只验证配置与 Compose，不启动服务
  -y, --yes             非交互确认
EOF
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || die "--env-file 缺少路径"
      ENV_FILE="$2"
      shift 2
      ;;
    --generate-env)
      GENERATE_ENV=1
      shift
      ;;
    --app-origin)
      (($# >= 2)) || die "--app-origin 缺少 URL"
      APP_ORIGIN_INPUT="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

generate_environment() {
  [[ -n "${APP_ORIGIN_INPUT}" ]] || die "--generate-env 必须同时提供 --app-origin https://正式域名"
  [[ "${APP_ORIGIN_INPUT}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || die "--app-origin 必须是不带路径的 HTTPS 地址"
  [[ ! -e "${ENV_FILE}" ]] || die "${ENV_FILE} 已存在，为避免覆盖密钥已停止"
  require_command openssl
  mkdir -p "$(dirname "${ENV_FILE}")"
  umask 077
  local version pii_one pii_two admin_password
  version="$(tr -d '[:space:]' < "${DEPLOY_ROOT}/VERSION")"
  pii_one="$(openssl rand -base64 32 | tr -d '\n')"
  pii_two="$(openssl rand -base64 32 | tr -d '\n')"
  admin_password="A$(openssl rand -hex 16)a9"
  cat > "${ENV_FILE}" <<EOF
APP_VERSION=${version}
APP_ORIGIN=${APP_ORIGIN_INPUT}
APP_BASE_PATH=/
BIND_ADDRESS=127.0.0.1
HTTP_PORT=8080
SQLITE_VOLUME_NAME=hainan_fttr_heartlink_sqlite_data
PII_ENCRYPTION_KEY_BASE64=${pii_one}
PII_LOOKUP_HMAC_KEY_BASE64=${pii_two}
BOOTSTRAP_ADMIN_USERNAME=ADMIN001
BOOTSTRAP_ADMIN_PASSWORD=${admin_password}
BACKUP_RETENTION_DAYS=30
BACKUP_DIR=./backups
EOF
  chmod 0600 "${ENV_FILE}"
  printf '已生成 %s（权限 0600）。\n' "${ENV_FILE}"
  printf '初始管理员：ADMIN001\n'
  printf '初始密码：%s\n' "${admin_password}"
  printf '请离线记录并在首次登录后立即修改。\n'
}

if ((GENERATE_ENV == 1)); then
  generate_environment
fi

validate_environment "${ENV_FILE}"
detect_compose
compose config >/dev/null || die "Compose 配置解析失败"

if ((CHECK_ONLY == 1)); then
  printf 'PASS: 密钥强度、HTTPS 与 Compose 配置检查通过\n'
  exit 0
fi

verify_package_checksums
require_command docker
if ((ASSUME_YES == 0)); then
  [[ -t 0 ]] || die "非交互环境请增加 --yes"
  printf '将构建镜像、创建数据库并启动系统。继续？[y/N] '
  read -r answer
  [[ "${answer}" =~ ^[Yy]$ ]] || die "安装已取消"
fi

mkdir -p "${DEPLOY_ROOT}/backups" "${DEPLOY_ROOT}/state"
chmod 0700 "${DEPLOY_ROOT}/backups" "${DEPLOY_ROOT}/state"

printf '==> 构建版本化镜像\n'
compose build --pull api web
printf '==> 先执行版本化迁移\n'
compose run --rm migrate
printf '==> 初始化管理员与默认提成规则\n'
compose run --rm seed
printf '==> 启动 API 与 Web\n'
compose up -d --no-build api web

local_url="http://127.0.0.1:$(env_value "${ENV_FILE}" HTTP_PORT)"
bash "${SCRIPT_DIR}/verify-v2.sh" --env-file "${ENV_FILE}" "${local_url}"
record_release install
printf 'PASS: 系统安装完成，内网验收地址 %s\n' "${local_url}"
printf '公网仅应通过 APP_ORIGIN 对应的 HTTPS 反向代理访问。\n'
