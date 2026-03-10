#!/usr/bin/env bash

set -euo pipefail

resolve_env_var() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s\n' "${!key}"
    return 0
  fi

  local env_file="${HOME}/.openclaw/.env"
  if [[ ! -f "${env_file}" ]]; then
    return 1
  fi

  awk -F= -v wanted="${key}" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      k = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      if (k != wanted) {
        next
      }
      value = substr(line, index(line, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit 0
    }
  ' "${env_file}"
}

resolve_placeholder_value() {
  local raw="${1:-}"
  if [[ -z "${raw}" ]]; then
    return 1
  fi

  if [[ "${raw}" =~ ^\$\{([A-Z0-9_]+)\}$ ]]; then
    resolve_env_var "${BASH_REMATCH[1]}"
    return $?
  fi

  printf '%s\n' "${raw}"
}

capitalize() {
  local value="${1:-}"
  if [[ -z "${value}" ]]; then
    printf '\n'
    return 0
  fi
  printf '%s%s\n' "$(printf '%s' "${value:0:1}" | tr '[:lower:]' '[:upper:]')" "${value:1}"
}

configured_extractors() {
  local config_path="$1"
  node --input-type=module - "${config_path}" <<'EOF'
import fs from "node:fs";

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const extraction = config?.plugins?.entries?.["memory-worthydb"]?.config?.extraction ?? {};
const records = [];

function pushRecord(slot, provider, model, apiKey) {
  records.push([slot, provider ?? "", model ?? "", apiKey ?? ""].join("\t"));
}

if (extraction && typeof extraction === "object" && !Array.isArray(extraction)) {
  if (extraction.primary && typeof extraction.primary === "object" && !Array.isArray(extraction.primary)) {
    pushRecord(
      "primary",
      extraction.primary.provider,
      extraction.primary.model,
      extraction.primary.apiKey,
    );
  } else if (
    typeof extraction.model === "string" ||
    typeof extraction.apiKey === "string" ||
    typeof extraction.timeoutMs === "number"
  ) {
    pushRecord("primary", "gemini", extraction.model, extraction.apiKey);
  }

  if (extraction.fallback && typeof extraction.fallback === "object" && !Array.isArray(extraction.fallback)) {
    pushRecord(
      "fallback",
      extraction.fallback.provider,
      extraction.fallback.model,
      extraction.fallback.apiKey,
    );
  }
}

for (const record of records) {
  console.log(record);
}
EOF
}

check_gemini_model() {
  local model="$1"
  local api_key="$2"
  curl -sS -o /dev/null -w "%{http_code}" \
    "https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${api_key}" || true
}

check_openai_model() {
  local model="$1"
  local api_key="$2"
  curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${api_key}" \
    "https://api.openai.com/v1/models/${model}" || true
}

check_together_model() {
  local model="$1"
  local api_key="$2"
  local response

  response="$(
    curl -sS -H "Authorization: Bearer ${api_key}" \
      "https://api.together.xyz/v1/models" || true
  )"

  if [[ -z "${response}" ]]; then
    return 1
  fi

  if printf '%s' "${response}" | node --input-type=module - "${model}" <<'EOF'
let input = "";
const wanted = process.argv[2];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(input);
    const models = Array.isArray(parsed) ? parsed : Array.isArray(parsed.models) ? parsed.models : [];
    const found = models.some((entry) => entry?.id === wanted || entry?.name === wanted);
    process.exit(found ? 0 : 1);
  } catch {
    process.exit(1);
  }
});
EOF
  then
    return 0
  fi

  return 1
}

echo "memory-worthydb compat check"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "openclaw CLI not found in PATH"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in PATH"
  exit 1
fi

echo "OpenClaw: $(openclaw --version 2>/dev/null || echo unknown)"

CONFIG_PATH="$(openclaw config file 2>/dev/null || true)"
case "${CONFIG_PATH}" in
  "~")
    CONFIG_PATH="${HOME}"
    ;;
  "~/"*)
    CONFIG_PATH="${HOME}/${CONFIG_PATH#\~/}"
    ;;
esac
if [[ -n "${CONFIG_PATH}" ]]; then
  echo "Config: ${CONFIG_PATH}"
fi

node --input-type=module <<'EOF'
await import("@lancedb/lancedb");
console.log("LanceDB import: OK");
EOF

if curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama: reachable"
else
  echo "Ollama: unreachable"
fi

if curl -fsS http://localhost:11434/api/tags | grep -q '"name":"qwen3-embedding'; then
  echo "Ollama model: qwen3-embedding present"
else
  echo "Ollama model: qwen3-embedding missing"
fi

found_extractor="false"
if [[ -n "${CONFIG_PATH}" && -f "${CONFIG_PATH}" ]]; then
  while IFS=$'\t' read -r slot provider model api_key_raw; do
    [[ -n "${slot}" ]] || continue
    found_extractor="true"
    slot_label="$(capitalize "${slot}")"

    if [[ -z "${provider}" || -z "${model}" ]]; then
      echo "${slot_label} extractor: incomplete config"
      continue
    fi

    resolved_key="$(resolve_placeholder_value "${api_key_raw}" || true)"
    if [[ -z "${resolved_key}" ]]; then
      echo "${slot_label} ${provider} API key: not found in env or ~/.openclaw/.env"
      continue
    fi

    case "${provider}" in
      gemini)
        status="$(check_gemini_model "${model}" "${resolved_key}")"
        if [[ "${status}" == "200" ]]; then
          echo "${slot_label} gemini model (${model}): reachable"
        else
          echo "${slot_label} gemini model (${model}): check failed (${status})"
        fi
        ;;
      openai)
        status="$(check_openai_model "${model}" "${resolved_key}")"
        if [[ "${status}" == "200" ]]; then
          echo "${slot_label} openai model (${model}): reachable"
        else
          echo "${slot_label} openai model (${model}): check failed (${status})"
        fi
        ;;
      together)
        if check_together_model "${model}" "${resolved_key}"; then
          echo "${slot_label} together model (${model}): reachable"
        else
          echo "${slot_label} together model (${model}): check failed"
        fi
        ;;
      *)
        echo "${slot_label} extractor (${provider}): unsupported provider"
        ;;
    esac
  done < <(configured_extractors "${CONFIG_PATH}")
fi

if [[ "${found_extractor}" != "true" ]]; then
  echo "Extraction providers: no configured memory-worthydb extractors found"
fi

if openclaw plugins list 2>/dev/null | grep -q "memory-worthydb"; then
  echo "Plugin registration: found"
else
  echo "Plugin registration: not found"
fi

echo "Compat check complete."
