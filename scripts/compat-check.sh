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

GEMINI_KEY="$(resolve_env_var GEMINI_API_KEY || true)"
if [[ -n "${GEMINI_KEY}" ]]; then
  HTTP_STATUS="$(
    curl -sS -o /dev/null -w "%{http_code}" \
      "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}" || true
  )"
  if [[ "${HTTP_STATUS}" == "200" ]]; then
    echo "Gemini API key: valid"
  else
    echo "Gemini API key: check failed (${HTTP_STATUS})"
  fi
else
  echo "Gemini API key: not found in env or ~/.openclaw/.env"
fi

if openclaw plugins list 2>/dev/null | grep -q "memory-worthydb"; then
  echo "Plugin registration: found"
else
  echo "Plugin registration: not found"
fi

echo "Compat check complete."
