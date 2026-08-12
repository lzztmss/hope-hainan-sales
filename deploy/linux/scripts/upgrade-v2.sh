#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
ASSUME_YES=0

usage() {
  cat <<'EOF'
用法：upgrade-v2.sh [--env-file FILE] [--yes]

升级前自动创建加密备份，再执行只向上的迁移。
脚本不会自动执行生产数据库 down-migration。
EOF
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || die "--env-file 缺少路径"
      ENV_FILE="$2"
      shift 2
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

validate_environment "${ENV_FILE}"
detect_compose
compose config >/dev/null || die "Compose 配置解析失败"
verify_package_checksums

if ((ASSUME_YES == 0)); then
  [[ -t 0 ]] || die "非交互环境请增加 --yes"
  printf '升级会先备份，再向上迁移。已确认本版数据库变更与当前应用向后兼容？[y/N] '
  read -r answer
  [[ "${answer}" =~ ^[Yy]$ ]] || die "升级已取消"
fi

printf '==> 升级前加密备份\n'
bash "${SCRIPT_DIR}/backup.sh" --env-file "${ENV_FILE}"

printf '==> 构建新版本镜像（旧版本 tag 保留）\n'
compose build --pull api web backup
compose up -d postgres
wait_for_postgres
printf '==> 执行只向上迁移\n'
compose run --rm migrate
compose run --rm seed
compose up -d --no-build api web

local_url="http://127.0.0.1:$(env_value "${ENV_FILE}" HTTP_PORT)"
bash "${SCRIPT_DIR}/verify-v2.sh" --env-file "${ENV_FILE}" "${local_url}"
record_release upgrade
printf 'PASS: 升级完成。如需应用回退，仅在数据库变更向后兼容时使用旧包旧镜像；不得自动 down-migrate。\n'
