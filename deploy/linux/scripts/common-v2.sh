#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${DEPLOY_ROOT}/../.." && pwd)"
COMPOSE_FILE="${DEPLOY_ROOT}/docker-compose.yml"
DEFAULT_ENV_FILE="${DEPLOY_ROOT}/.env"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-hainan-fttr-heartlink}"
COMPOSE_COMMAND=()

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1"
}

env_value() {
  local env_file="$1"
  local key="$2"
  awk -v wanted="${key}" '
    index($0, wanted "=") == 1 {
      value = substr($0, length(wanted) + 2)
      sub(/\r$/, "", value)
      if (value ~ /^".*"$/ || value ~ /^\047.*\047$/) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "${env_file}"
}

reject_placeholder() {
  local name="$1"
  local value="$2"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  case "${lowered}" in
    ""|password|password123|admin|admin123|123456|12345678|changeme|*replace_me*|*replace-with*|*replace_with*|*example-secret*|*your_secret*)
      die "${name} 不得为空、占位值或常见默认密码"
      ;;
  esac
  if [[ "${value}" == *'<'* || "${value}" == *'>'* ]]; then
    die "${name} 仍是占位值"
  fi
}

decoded_key_length() {
  local value="$1"
  local decoded
  decoded="$(mktemp "${TMPDIR:-/tmp}/hfttr-key.XXXXXX")"
  if ! printf '%s' "${value}" | openssl base64 -d -A > "${decoded}" 2>/dev/null; then
    rm -f "${decoded}"
    printf '0'
    return
  fi
  wc -c < "${decoded}" | tr -d ' '
  rm -f "${decoded}"
}

validate_environment() {
  local env_file="$1"
  [[ -f "${env_file}" ]] || die "缺少 ${env_file}；请先复制 .env.example 或运行 install-v2.sh --generate-env"
  require_command openssl

  local app_version app_origin bind_address http_port postgres_db postgres_user postgres_volume postgres_password
  local pii_encryption pii_lookup admin_username admin_password backup_passphrase retention
  app_version="$(env_value "${env_file}" APP_VERSION)"
  app_origin="$(env_value "${env_file}" APP_ORIGIN)"
  bind_address="$(env_value "${env_file}" BIND_ADDRESS)"
  http_port="$(env_value "${env_file}" HTTP_PORT)"
  postgres_db="$(env_value "${env_file}" POSTGRES_DB)"
  postgres_user="$(env_value "${env_file}" POSTGRES_USER)"
  postgres_volume="$(env_value "${env_file}" POSTGRES_VOLUME_NAME)"
  postgres_password="$(env_value "${env_file}" POSTGRES_PASSWORD)"
  pii_encryption="$(env_value "${env_file}" PII_ENCRYPTION_KEY_BASE64)"
  pii_lookup="$(env_value "${env_file}" PII_LOOKUP_HMAC_KEY_BASE64)"
  admin_username="$(env_value "${env_file}" BOOTSTRAP_ADMIN_USERNAME)"
  admin_password="$(env_value "${env_file}" BOOTSTRAP_ADMIN_PASSWORD)"
  backup_passphrase="$(env_value "${env_file}" BACKUP_ENCRYPTION_PASSPHRASE)"
  retention="$(env_value "${env_file}" BACKUP_RETENTION_DAYS)"

  [[ "${app_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9]{8}$ ]] || die "APP_VERSION 必须采用 X.Y.Z-YYYYMMDD 格式"
  [[ "${app_origin}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || die "APP_ORIGIN 必须是不带路径的正式 HTTPS 地址"
  [[ "${bind_address:-127.0.0.1}" == "127.0.0.1" ]] || die "BIND_ADDRESS 生产必须为 127.0.0.1，由外层 HTTPS 反向代理公开"
  [[ "${http_port:-8080}" =~ ^[0-9]{1,5}$ ]] || die "HTTP_PORT 必须为 1–65535"
  ((10#${http_port:-8080} >= 1 && 10#${http_port:-8080} <= 65535)) || die "HTTP_PORT 必须为 1–65535"
  [[ "${postgres_db}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "POSTGRES_DB 格式无效"
  [[ "${postgres_user}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "POSTGRES_USER 格式无效"
  [[ "${postgres_volume:-hainan_fttr_heartlink_postgres_data}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$ ]] || die "POSTGRES_VOLUME_NAME 格式无效"
  reject_placeholder POSTGRES_PASSWORD "${postgres_password}"
  [[ "${postgres_password}" =~ ^[A-Za-z0-9_-]{24,128}$ ]] || die "POSTGRES_PASSWORD 需为 24–128 位 URL 安全随机字符"

  reject_placeholder PII_ENCRYPTION_KEY_BASE64 "${pii_encryption}"
  reject_placeholder PII_LOOKUP_HMAC_KEY_BASE64 "${pii_lookup}"
  [[ "$(decoded_key_length "${pii_encryption}")" == "32" ]] || die "PII_ENCRYPTION_KEY_BASE64 必须解码为 32 字节"
  [[ "$(decoded_key_length "${pii_lookup}")" == "32" ]] || die "PII_LOOKUP_HMAC_KEY_BASE64 必须解码为 32 字节"
  [[ "${pii_encryption}" != "${pii_lookup}" ]] || die "两个 PII 密钥不得相同"

  [[ "${admin_username}" =~ ^[A-Za-z0-9_-]{3,32}$ ]] || die "BOOTSTRAP_ADMIN_USERNAME 格式无效"
  reject_placeholder BOOTSTRAP_ADMIN_PASSWORD "${admin_password}"
  ((${#admin_password} >= 16 && ${#admin_password} <= 128)) || die "BOOTSTRAP_ADMIN_PASSWORD 至少 16 位"
  [[ "${admin_password}" =~ [A-Z] && "${admin_password}" =~ [a-z] && "${admin_password}" =~ [0-9] ]] ||
    die "BOOTSTRAP_ADMIN_PASSWORD 必须同时包含大写字母、小写字母和数字"

  reject_placeholder BACKUP_ENCRYPTION_PASSPHRASE "${backup_passphrase}"
  ((${#backup_passphrase} >= 24 && ${#backup_passphrase} <= 256)) || die "BACKUP_ENCRYPTION_PASSPHRASE 至少 24 位"
  [[ "${retention:-30}" =~ ^[0-9]{1,4}$ ]] || die "BACKUP_RETENTION_DAYS 必须是 1–3650"
  ((10#${retention:-30} >= 1 && 10#${retention:-30} <= 3650)) || die "BACKUP_RETENTION_DAYS 必须是 1–3650"
}

detect_compose() {
  if [[ -n "${COMPOSE_BIN:-}" ]]; then
    command -v "${COMPOSE_BIN}" >/dev/null 2>&1 || die "COMPOSE_BIN 不可用：${COMPOSE_BIN}"
    COMPOSE_COMMAND=("${COMPOSE_BIN}")
  elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_COMMAND=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_COMMAND=(docker-compose)
  else
    die "未找到 docker compose 或 docker-compose"
  fi
}

compose() {
  local env_file="${ENV_FILE:-${DEFAULT_ENV_FILE}}"
  ((${#COMPOSE_COMMAND[@]} > 0)) || detect_compose
  "${COMPOSE_COMMAND[@]}" --env-file "${env_file}" -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" "$@"
}

verify_package_checksums() {
  local manifest="${PROJECT_ROOT}/CHECKSUMS.sha256"
  [[ -f "${manifest}" ]] || return 0
  printf '==> 校验安装包 SHA-256\n'
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "${PROJECT_ROOT}" && sha256sum -c CHECKSUMS.sha256 >/dev/null) || die "安装包 SHA-256 校验失败"
  else
    require_command shasum
    (cd "${PROJECT_ROOT}" && shasum -a 256 -c CHECKSUMS.sha256 >/dev/null) || die "安装包 SHA-256 校验失败"
  fi
}

wait_for_postgres() {
  local attempts=0
  until compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    ((attempts < 60)) || die "PostgreSQL 在 120 秒内未就绪"
    sleep 2
  done
}

record_release() {
  local action="$1"
  local version migration
  version="$(env_value "${ENV_FILE}" APP_VERSION)"
  migration="$(awk -F\" '/"tag"/{value=$4} END{print value}' "${PROJECT_ROOT}/drizzle/meta/_journal.json")"
  mkdir -p "${DEPLOY_ROOT}/state"
  chmod 0700 "${DEPLOY_ROOT}/state"
  printf '%s\taction=%s\tapp=%s\tschema=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${action}" "${version}" "${migration:-unknown}" >> "${DEPLOY_ROOT}/state/release-history.log"
  chmod 0600 "${DEPLOY_ROOT}/state/release-history.log"
}
