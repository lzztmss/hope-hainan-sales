#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
BASE_URL=""
while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || die "--env-file 缺少路径"
      ENV_FILE="$2"
      shift 2
      ;;
    -h|--help)
      printf '用法：verify-v2.sh [--env-file FILE] [URL]\n'
      exit 0
      ;;
    http://*|https://*)
      [[ -z "${BASE_URL}" ]] || die "只能提供一个 URL"
      BASE_URL="${1%/}"
      shift
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

validate_environment "${ENV_FILE}"
detect_compose
BASE_URL="${BASE_URL:-http://127.0.0.1:$(env_value "${ENV_FILE}" HTTP_PORT)}"
require_command curl

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/hfttr-v2-verify.XXXXXX")"
trap 'rm -rf "${tmp_root}"' EXIT

printf '==> 检查 Compose 服务状态\n'
compose ps >/dev/null || die "无法读取 Compose 状态"
printf '==> 检查 Web 首页\n'
curl --fail --silent --show-error --location --connect-timeout 5 --max-time 20 \
  --dump-header "${tmp_root}/headers" --output "${tmp_root}/index.html" "${BASE_URL}/"
grep -Eqi 'FTTR|heartlink|心连心' "${tmp_root}/index.html" || die "首页品牌标识不匹配"
grep -Eqi '^X-Content-Type-Options:[[:space:]]*nosniff' "${tmp_root}/headers" || die "缺少 nosniff 响应头"
grep -Eqi '^Content-Security-Policy:' "${tmp_root}/headers" || die "缺少 CSP 响应头"

printf '==> 检查 API 健康端点\n'
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  --dump-header "${tmp_root}/api-headers" --output "${tmp_root}/health.json" "${BASE_URL}/api/health"
grep -Fq '"status":"ok"' "${tmp_root}/health.json" || die "API 健康响应不正确"
grep -Eqi '^Cache-Control:[[:space:]]*no-store' "${tmp_root}/api-headers" || die "API 未禁止敏感响应缓存"

printf '==> 检查 SQLite 完整性与迁移记录\n'
database_check="$(compose exec -T api node -e \"const D=require('better-sqlite3');const d=new D(process.env.SQLITE_PATH,{readonly:true});const ok=d.pragma('integrity_check')[0]?.integrity_check;const n=d.prepare('SELECT COUNT(*) n FROM __drizzle_migrations').get().n;d.close();process.stdout.write(ok+':'+n)\")"
[[ "${database_check}" =~ ^ok:[1-9][0-9]*$ ]] || die "SQLite 完整性或迁移记录检查失败"

printf 'PASS: Web、API、安全头、SQLite 和迁移记录验证通过\n'
