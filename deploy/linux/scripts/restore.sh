#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
BACKUP_PATH=""
STAGING_DATABASE=""
CONFIRM_PRODUCTION=""
ASSUME_YES=0

usage() {
  cat <<'EOF'
用法：restore.sh --backup FILE [参数]

  --staging-database DB              指定全新临时库（默认自动命名）
  --confirm-production-overwrite DB 验证 staging 后切换生产；DB 必须精确等于 POSTGRES_DB
  --env-file FILE                    指定 .env
  -y, --yes                          生产切换非交互确认

默认只恢复到全新 staging 库，绝不覆盖生产。
EOF
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || die "--env-file 缺少路径"
      ENV_FILE="$2"
      shift 2
      ;;
    --backup)
      (($# >= 2)) || die "--backup 缺少路径"
      BACKUP_PATH="$2"
      shift 2
      ;;
    --staging-database)
      (($# >= 2)) || die "--staging-database 缺少库名"
      STAGING_DATABASE="$2"
      shift 2
      ;;
    --confirm-production-overwrite)
      (($# >= 2)) || die "--confirm-production-overwrite 缺少生产库名"
      CONFIRM_PRODUCTION="$2"
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

[[ -n "${BACKUP_PATH}" ]] || die "必须提供 --backup"
[[ -f "${BACKUP_PATH}" ]] || die "找不到备份：${BACKUP_PATH}"
[[ -f "${BACKUP_PATH}.sha256" ]] || die "备份缺少 .sha256"
validate_environment "${ENV_FILE}"
export BACKUP_RUN_UID="${BACKUP_RUN_UID:-$(id -u)}"
export BACKUP_RUN_GID="${BACKUP_RUN_GID:-$(id -g)}"
detect_compose

postgres_db="$(env_value "${ENV_FILE}" POSTGRES_DB)"
if [[ -z "${STAGING_DATABASE}" ]]; then
  STAGING_DATABASE="${postgres_db}_restore_$(date -u +%Y%m%d%H%M%S)"
fi
[[ "${STAGING_DATABASE}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "staging 库名格式无效或过长"

backup_dir="$(cd "$(dirname "${BACKUP_PATH}")" && pwd)"
configured_backup_dir="${BACKUP_DIR:-$(env_value "${ENV_FILE}" BACKUP_DIR)}"
configured_backup_dir="${configured_backup_dir:-./backups}"
configured_backup_abs="$(cd "${DEPLOY_ROOT}" && mkdir -p "${configured_backup_dir}" && cd "${configured_backup_dir}" && pwd)"
if [[ "${backup_dir}" != "${configured_backup_abs}" ]]; then
  cp "${BACKUP_PATH}" "${BACKUP_PATH}.sha256" "${configured_backup_abs}/"
  [[ -f "${BACKUP_PATH}.meta" ]] && cp "${BACKUP_PATH}.meta" "${configured_backup_abs}/"
fi
container_backup="/backups/$(basename "${BACKUP_PATH}")"

if [[ -n "${CONFIRM_PRODUCTION}" ]]; then
  [[ "${CONFIRM_PRODUCTION}" == "${postgres_db}" ]] || die "确认值必须精确等于 ${postgres_db}"
  if ((ASSUME_YES == 0)); then
    [[ -t 0 ]] || die "生产切换的非交互环境请增加 --yes"
    printf '即将停止 Web/API，保留旧库并切换经验证的 staging。继续？[yes/NO] '
    read -r answer
    [[ "${answer}" == "yes" ]] || die "生产切换已取消"
  fi
fi

compose up -d postgres
wait_for_postgres
restore_args=(--rm --entrypoint /opt/deploy/container-restore.sh -e "BACKUP_FILE=${container_backup}" -e "STAGING_DATABASE=${STAGING_DATABASE}")
if [[ -n "${CONFIRM_PRODUCTION}" ]]; then
  compose stop web api
  restore_args+=(-e "CONFIRM_PRODUCTION_OVERWRITE=${CONFIRM_PRODUCTION}")
fi

set +e
compose --profile maintenance run "${restore_args[@]}" backup
restore_status=$?
set -e
if [[ -n "${CONFIRM_PRODUCTION}" ]]; then
  compose up -d --no-build api web
fi
((restore_status == 0)) || die "恢复未完成，请查看上方错误；生产服务已尝试重新启动"

if [[ -n "${CONFIRM_PRODUCTION}" ]]; then
  local_url="http://127.0.0.1:$(env_value "${ENV_FILE}" HTTP_PORT)"
  bash "${SCRIPT_DIR}/verify-v2.sh" --env-file "${ENV_FILE}" "${local_url}"
fi
