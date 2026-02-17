#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
import os


def transform(payload: dict) -> dict:
    """
    Deterministic transform scaffold.
    Replace business mapping logic as needed per migration version.
    """
    data = payload.get("payload", {}).get("data", {})
    result = {
        "meta": {
            "transformedAt": datetime.now(timezone.utc).isoformat(),
            "sourceMeta": payload.get("meta", {}),
        },
        "records": [],
    }

    # Example passthrough normalization.
    for entity_name, rows in data.items():
        if not isinstance(rows, list):
            continue
        for row in rows:
            result["records"].append({
                "entity": entity_name,
                "id": row.get("id"),
                "data": row,
            })

    return result


def write_audit(stage: str, script_name: str, payload: dict, run_id: str, org_id: str, env_name: str, audit_dir: str) -> None:
    record = {
        "runId": run_id,
        "orgId": org_id,
        "envName": env_name,
        "script": script_name,
        "stage": stage,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }

    os.makedirs(audit_dir, exist_ok=True)
    local_path = os.path.join(audit_dir, f"{run_id}.{script_name}.{stage}.json")
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-id", default=f"run-{int(datetime.now(timezone.utc).timestamp())}")
    parser.add_argument("--org", default="")
    parser.add_argument("--env", default="production")
    parser.add_argument("--audit-dir", default=".migration-audit")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        source = json.load(f)
    write_audit(
        "snapshot",
        "transform_dataset",
        {"input": os.path.abspath(args.input)},
        args.run_id,
        args.org,
        args.env,
        args.audit_dir,
    )

    target = transform(source)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(target, f, indent=2, ensure_ascii=True)
    write_audit(
        "final",
        "transform_dataset",
        {
            "output": os.path.abspath(args.output),
            "records": len(target.get("records", [])),
        },
        args.run_id,
        args.org,
        args.env,
        args.audit_dir,
    )

    print(f"Transformed dataset written: {args.output}")


if __name__ == "__main__":
    main()
