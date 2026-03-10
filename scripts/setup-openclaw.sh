#!/usr/bin/env bash

set -euo pipefail
umask 077

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "Required command not found: ${command_name}"
}

path_with_tilde() {
  local value="$1"
  case "${value}" in
    "${HOME}")
      printf '~\n'
      ;;
    "${HOME}/"*)
      printf '~/%s\n' "${value#"${HOME}/"}"
      ;;
    *)
      printf '%s\n' "${value}"
      ;;
  esac
}

prompt_with_default() {
  local __target="$1"
  local prompt="$2"
  local default_value="$3"
  local response=""

  printf '%s [%s]: ' "${prompt}" "${default_value}"
  if ! IFS= read -r response; then
    response=""
  fi
  if [[ -z "${response}" ]]; then
    response="${default_value}"
  fi

  printf -v "${__target}" '%s' "${response}"
}

prompt_yes_no() {
  local __target="$1"
  local prompt="$2"
  local default_value="$3"
  local default_label=""
  local response=""

  if [[ "${default_value}" == "true" ]]; then
    default_label="Y/n"
  else
    default_label="y/N"
  fi

  while true; do
    printf '%s [%s]: ' "${prompt}" "${default_label}"
    if ! IFS= read -r response; then
      response=""
    fi
    case "${response}" in
      "")
        printf -v "${__target}" '%s' "${default_value}"
        return 0
        ;;
      [Yy]|[Yy][Ee][Ss]|[Tt][Rr][Uu][Ee])
        printf -v "${__target}" '%s' "true"
        return 0
        ;;
      [Nn]|[Nn][Oo]|[Ff][Aa][Ll][Ss][Ee])
        printf -v "${__target}" '%s' "false"
        return 0
        ;;
      *)
        warn "Please answer yes or no."
        ;;
    esac
  done
}

prompt_integer() {
  local __target="$1"
  local prompt="$2"
  local default_value="$3"
  local min_value="$4"
  local max_value="$5"
  local response=""

  while true; do
    printf '%s [%s]: ' "${prompt}" "${default_value}"
    if ! IFS= read -r response; then
      response=""
    fi
    if [[ -z "${response}" ]]; then
      response="${default_value}"
    fi

    if [[ "${response}" =~ ^[0-9]+$ ]] && (( response >= min_value && response <= max_value )); then
      printf -v "${__target}" '%s' "${response}"
      return 0
    fi

    warn "Enter a whole number between ${min_value} and ${max_value}."
  done
}

prompt_float() {
  local __target="$1"
  local prompt="$2"
  local default_value="$3"
  local min_value="$4"
  local max_value="$5"
  local response=""

  while true; do
    printf '%s [%s]: ' "${prompt}" "${default_value}"
    if ! IFS= read -r response; then
      response=""
    fi
    if [[ -z "${response}" ]]; then
      response="${default_value}"
    fi

    if awk -v value="${response}" -v min="${min_value}" -v max="${max_value}" '
      BEGIN {
        if (value !~ /^([0-9]+([.][0-9]+)?|[.][0-9]+)$/) {
          exit 1
        }
        numeric = value + 0
        exit !(numeric >= min && numeric <= max)
      }
    '; then
      printf -v "${__target}" '%s' "${response}"
      return 0
    fi

    warn "Enter a number between ${min_value} and ${max_value}."
  done
}

run_checked() {
  local description="$1"
  shift

  log ""
  log "==> ${description}"
  if ! "$@"; then
    fail "${description} failed."
  fi
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

require_command openclaw
require_command node
require_command npm
require_command curl

[[ -f "${repo_root}/openclaw.plugin.json" ]] || fail "Plugin manifest not found in ${repo_root}"
[[ -f "${repo_root}/package.json" ]] || fail "package.json not found in ${repo_root}"

config_path="$(openclaw config file)"
config_dir="$(dirname -- "${config_path}")"
state_dir="${OPENCLAW_STATE_DIR:-${config_dir}}"
default_db_path="$(path_with_tilde "${state_dir}/memory/worthydb/{agentId}")"

log "memory-worthydb setup"
log "Repo: ${repo_root}"
log "OpenClaw config: ${config_path}"
log ""
log "This script links the local plugin checkout into OpenClaw and writes"
log "plugins.entries.memory-worthydb plus plugins.slots.memory."
log ""

if [[ -f "${config_path}" ]]; then
  backup_path="${config_path}.worthydb-setup-$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -p -- "${config_path}" "${backup_path}"
  log "Backed up existing config to ${backup_path}"
fi

if [[ "${WORTHYDB_SETUP_SKIP_BUILD:-0}" != "1" ]]; then
  run_checked "Building plugin" npm --prefix "${repo_root}" run build
else
  log "Skipping npm run build because WORTHYDB_SETUP_SKIP_BUILD=1"
fi

log ""
log "Leave prompts blank to accept the recommended defaults."

prompt_with_default extraction_api_key "Gemini API key or placeholder" '${GEMINI_API_KEY}'
prompt_with_default extraction_model "Gemini model" "gemini-2.5-flash-lite"
prompt_with_default ollama_url "Ollama URL" "http://localhost:11434"
prompt_with_default embedding_model "Embedding model" "qwen3-embedding:latest"
prompt_integer embedding_dimensions "Embedding dimensions" "4096" "1" "16384"
prompt_with_default db_path "Database path template" "${default_db_path}"
prompt_yes_no auto_capture "Enable auto-capture" "true"
prompt_yes_no auto_recall "Enable auto-recall" "true"
prompt_integer max_recall_results "Max recall results" "8" "1" "20"
prompt_float recall_min_score "Recall minimum score" "0.45" "0" "1"
prompt_float dedup_threshold "Dedup threshold" "0.95" "0.5" "0.9999"
prompt_integer ttl_preference "Preference TTL in days" "365" "0" "3650"
prompt_integer ttl_decision "Decision TTL in days" "180" "0" "3650"
prompt_integer ttl_entity "Entity TTL in days (0 disables expiry)" "0" "0" "3650"
prompt_integer ttl_fact "Fact TTL in days" "90" "0" "3650"
prompt_integer ttl_other "Other TTL in days" "30" "0" "3650"

config_payload="$(
  WORTHYDB_EXTRACTION_API_KEY="${extraction_api_key}" \
  WORTHYDB_EXTRACTION_MODEL="${extraction_model}" \
  WORTHYDB_OLLAMA_URL="${ollama_url}" \
  WORTHYDB_EMBEDDING_MODEL="${embedding_model}" \
  WORTHYDB_EMBEDDING_DIMENSIONS="${embedding_dimensions}" \
  WORTHYDB_DB_PATH="${db_path}" \
  WORTHYDB_AUTO_CAPTURE="${auto_capture}" \
  WORTHYDB_AUTO_RECALL="${auto_recall}" \
  WORTHYDB_MAX_RECALL_RESULTS="${max_recall_results}" \
  WORTHYDB_RECALL_MIN_SCORE="${recall_min_score}" \
  WORTHYDB_DEDUP_THRESHOLD="${dedup_threshold}" \
  WORTHYDB_TTL_PREFERENCE="${ttl_preference}" \
  WORTHYDB_TTL_DECISION="${ttl_decision}" \
  WORTHYDB_TTL_ENTITY="${ttl_entity}" \
  WORTHYDB_TTL_FACT="${ttl_fact}" \
  WORTHYDB_TTL_OTHER="${ttl_other}" \
  node --input-type=module <<'EOF'
const intValue = (name) => Number.parseInt(process.env[name] ?? "", 10);
const floatValue = (name) => Number.parseFloat(process.env[name] ?? "");
const boolValue = (name) => (process.env[name] ?? "false") === "true";

const payload = {
  extraction: {
    apiKey: process.env.WORTHYDB_EXTRACTION_API_KEY,
    model: process.env.WORTHYDB_EXTRACTION_MODEL,
  },
  embedding: {
    ollamaUrl: process.env.WORTHYDB_OLLAMA_URL,
    model: process.env.WORTHYDB_EMBEDDING_MODEL,
    dimensions: intValue("WORTHYDB_EMBEDDING_DIMENSIONS"),
  },
  dbPath: process.env.WORTHYDB_DB_PATH,
  autoCapture: boolValue("WORTHYDB_AUTO_CAPTURE"),
  autoRecall: boolValue("WORTHYDB_AUTO_RECALL"),
  maxRecallResults: intValue("WORTHYDB_MAX_RECALL_RESULTS"),
  recallMinScore: floatValue("WORTHYDB_RECALL_MIN_SCORE"),
  dedup: {
    threshold: floatValue("WORTHYDB_DEDUP_THRESHOLD"),
  },
  ttl: {
    preference: intValue("WORTHYDB_TTL_PREFERENCE"),
    decision: intValue("WORTHYDB_TTL_DECISION"),
    entity: intValue("WORTHYDB_TTL_ENTITY"),
    fact: intValue("WORTHYDB_TTL_FACT"),
    other: intValue("WORTHYDB_TTL_OTHER"),
  },
};

process.stdout.write(JSON.stringify(payload));
EOF
)"

run_checked "Linking plugin into OpenClaw" openclaw plugins install --link "${repo_root}"
run_checked "Enabling plugin entry" openclaw config set plugins.entries.memory-worthydb.enabled true --json
run_checked "Selecting memory-worthydb as the active memory plugin" \
  openclaw config set plugins.slots.memory '"memory-worthydb"' --json
run_checked "Writing memory-worthydb configuration" \
  openclaw config set plugins.entries.memory-worthydb.config "${config_payload}" --json

if ! curl -fsS --max-time 2 "${ollama_url%/}/api/tags" >/dev/null 2>&1; then
  warn "Ollama is not reachable at ${ollama_url}. Recall/search will not work until it is running."
elif ! curl -fsS --max-time 2 "${ollama_url%/}/api/tags" | grep -Fq "\"name\":\"${embedding_model%%:*}"; then
  warn "Ollama is reachable, but the ${embedding_model} model was not detected in /api/tags."
fi

if [[ "${extraction_api_key}" == '${GEMINI_API_KEY}' ]] && [[ -z "${GEMINI_API_KEY:-}" ]]; then
  warn "Config uses \${GEMINI_API_KEY}, but GEMINI_API_KEY is not set in the current environment."
fi

log ""
log "Setup complete."
log ""
log "Verification:"
log "  openclaw plugins list | grep memory-worthydb"
log "  openclaw plugins doctor"
log "  openclaw worthydb stats --agent main"
log "  ${repo_root}/scripts/compat-check.sh"
