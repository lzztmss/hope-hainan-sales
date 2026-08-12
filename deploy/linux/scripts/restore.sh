#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
BACKUP_PATH=""
ASSUME_YES=0
while (($# > 0)); do
  case "$1" in
    --env-file) (($# >= 2)) || die "--env-file 缺少路径"; ENV_FILE="$2"; shift 2 ;;
    --backup) (($# >= 2)) || die "--backup 缺少路径"; BACKUP_PATH="$2"; shift 2 ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) printf '用法：restore.sh --backup FILE [--env-file FILE] [--yes]\n'; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ -n "${BACKUP_PATH}" && -f "${BACKUP_PATH}" ]] || die "必须提供存在的 --backup FILE"
[[ -f "${BACKUP_PATH}.sha256" ]] || die "备份缺少 .sha256 校验文件"
validate_environment "${ENV_FILE}"
detect_compose

configured_backup="${BACKUP_DIR:-$(env_value "${ENV_FILE}" BACKUP_DIR)}"
configured_backup="${configured_backup:-./backups}"
backup_dir="$(cd "${DEPLOY_ROOT}" && mkdir -p "${configured_backup}" && cd "${configured_backup}" && pwd)"
source_dir="$(cd "$(dirname "${BACKUP_PATH}")" && pwd)"
if [[ "${source_dir}" != "${backup_dir}" ]]; then
  cp "${BACKUP_PATH}" "${BACKUP_PATH}.sha256" "${backup_dir}/"
fi
container_backup="/backups/$(basename "${BACKUP_PATH}")"

if ((ASSUME_YES == 0)); then
  [[ -t 0 ]] || die "非交互恢复请增加 --yes"
  printf '恢复会短暂停止 Web/API，并保留当前数据库副本。输入 RESTORE 继续：'
  read -r answer
  [[ "${answer}" == "RESTORE" ]] || die "恢复已取消"
fi

compose stop web api
set +e
BACKUP_FILE="${container_backup}" CONFIRM_SQLITE_RESTORE=RESTORE \
  compose --profile maintenance run --rm restore
restore_status=$?
set -e
compose up -d --no-build api web
((restore_status == 0)) || die "恢复失败；服务已尝试重新启动"
local_url="http://127.0.0.1:$(env_value "${ENV_FILE}" HTTP_PORT)"
bash "${SCRIPT_DIR}/verify-v2.sh" --env-file "${ENV_FILE}" "${local_url}"
