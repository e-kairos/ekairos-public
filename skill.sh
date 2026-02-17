#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${ROOT_DIR}/skills"
DIST_DIR="${ROOT_DIR}/.ekairos/skills-dist"

cmd="${1:-list}"
shift || true

list_skills() {
  find "${SKILLS_DIR}" -mindepth 1 -maxdepth 1 -type d -print | sed 's|.*/||' | sort
}

validate_skill() {
  local name="$1"
  local base="${SKILLS_DIR}/${name}"
  [[ -d "${base}" ]] || { echo "Skill not found: ${name}" >&2; return 1; }
  [[ -f "${base}/SKILL.md" ]] || { echo "Missing SKILL.md in ${name}" >&2; return 1; }
}

bundle_skill() {
  local name="$1"
  local base="${SKILLS_DIR}/${name}"
  local out="${DIST_DIR}/${name}.tgz"
  mkdir -p "${DIST_DIR}"
  tar -czf "${out}" -C "${SKILLS_DIR}" "${name}"
  echo "${out}"
}

install_skill() {
  local name="$1"
  local target="${2:-${HOME}/.codex/skills/${name}}"
  rm -rf "${target}"
  mkdir -p "$(dirname "${target}")"
  cp -R "${SKILLS_DIR}/${name}" "${target}"
  echo "Installed ${name} -> ${target}"
}

case "${cmd}" in
  list)
    list_skills
    ;;
  validate)
    name="${1:?usage: skill.sh validate <skill-name>}"
    validate_skill "${name}"
    echo "OK: ${name}"
    ;;
  bundle)
    name="${1:?usage: skill.sh bundle <skill-name>}"
    validate_skill "${name}"
    bundle_skill "${name}"
    ;;
  install)
    name="${1:?usage: skill.sh install <skill-name> [target-dir]}"
    target="${2:-}"
    validate_skill "${name}"
    install_skill "${name}" "${target}"
    ;;
  *)
    cat <<'EOF'
Usage:
  ./skill.sh list
  ./skill.sh validate <skill-name>
  ./skill.sh bundle <skill-name>
  ./skill.sh install <skill-name> [target-dir]
EOF
    exit 1
    ;;
esac

