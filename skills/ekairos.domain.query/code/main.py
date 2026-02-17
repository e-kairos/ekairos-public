import json
import os
import urllib.request
import urllib.error


def _normalize_base_url(value):
    if not value:
        return None
    trimmed = str(value).strip()
    if not trimmed:
        return None
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return trimmed.rstrip("/")
    return f"https://{trimmed.rstrip('/')}"


def _read_json_arg(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"query is not valid JSON: {exc}")
    raise ValueError("query must be an object or JSON string")


def main(args: dict):
    args = args or {}
    org_id = str(args.get("org_id") or os.getenv("EKAIROS_ORG_ID") or "").strip()
    base_url = _normalize_base_url(args.get("base_url") or os.getenv("EKAIROS_DOMAIN_BASE_URL"))
    token = (
        str(os.getenv("EKAIROS_DOMAIN_OIDC_TOKEN") or "").strip()
        or str(os.getenv("EKAIROS_DOMAIN_TOKEN") or "").strip()
    )

    if not base_url:
        return {"ok": False, "error": "Missing EKAIROS_DOMAIN_BASE_URL or base_url"}
    if not org_id:
        return {"ok": False, "error": "Missing org_id or EKAIROS_ORG_ID"}

    try:
        query = _read_json_arg(args.get("query"))
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    if query is None:
        return {"ok": False, "error": "Missing query"}

    endpoint = f"{base_url}/.well-known/ekairos/v1/domain"
    payload = json.dumps({"orgId": org_id, "query": query}).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read().decode("utf-8")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"ok": False, "error": "Invalid JSON response", "raw": body}
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        return {
            "ok": False,
            "status": exc.code,
            "error": body or exc.reason or "HTTP error",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
