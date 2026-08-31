#!/usr/bin/env python3
"""Export one calendar month of mini-program news into the Orbit updater payload."""

from __future__ import annotations

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

SEARCH_URL = "https://links.he-ting.com/api/news/search"
PAGE_SIZE = 50


def fetch_page(kind: str, query: str, offset: int) -> dict:
    response = requests.get(
        SEARCH_URL,
        params={
            "q": query,
            "kind": kind,
            "sort": "time",
            "scope": "all",
            "offset": offset,
            "limit": PAGE_SIZE,
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def month_rows(kind: str, query: str, month: str) -> list[dict]:
    first = fetch_page(kind, query, 0)
    total = int(first.get("total") or 0)
    pages = {0: first}
    offsets = list(range(PAGE_SIZE, total, PAGE_SIZE))
    for start in range(0, len(offsets), 6):
        batch = offsets[start:start + 6]
        with ThreadPoolExecutor(max_workers=len(batch)) as pool:
            futures = {pool.submit(fetch_page, kind, query, offset): offset for offset in batch}
            for future in as_completed(futures):
                pages[futures[future]] = future.result()
        oldest = min(
            (str(item.get("published") or "")[:7] for payload in pages.values() for item in payload.get("items") or []),
            default="",
        )
        if oldest and oldest < month:
            break
    rows: dict[str, dict] = {}
    for payload in pages.values():
        for item in payload.get("items") or []:
            if str(item.get("published") or "").startswith(month):
                rows[str(item.get("id") or "")] = item
    return list(rows.values())


def normalize(item: dict, output_kind: str) -> dict:
    link = str(item.get("link") or "")
    return {
        "id": str(item.get("id") or ""),
        "kind": output_kind,
        "title": str(item.get("title") or "").strip(),
        "summary": str(item.get("summary") or "").strip(),
        "image": str(item.get("image") or ""),
        "source": str(item.get("source") or ""),
        "published": str(item.get("published") or ""),
        "tags": list(item.get("tags") or []),
        "page_url": link,
        "original_url": "",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", required=True, help="Calendar month in YYYY-MM format")
    parser.add_argument("--date-to", required=True, help="Inclusive end date in YYYY-MM-DD format")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    date_from = f"{args.month}-01"
    if not args.date_to.startswith(args.month):
        raise SystemExit("--date-to must belong to --month")

    intl = month_rows("intl", "a", args.month)
    techport = month_rows("techport", "a", args.month)
    general = month_rows("gzh", "的", args.month)
    debris = month_rows("debris", "碎片", args.month)

    items = []
    for row in intl:
        output_kind = "spacenews" if "spacenews" in str(row.get("source") or "").lower() else "news"
        items.append(normalize(row, output_kind))
    items.extend(normalize(row, "news") for row in general)
    items.extend(normalize(row, "techport") for row in techport)
    items.extend(normalize(row, "debris") for row in debris)

    deduped = {item["id"]: item for item in items if item["id"] and item["title"]}
    items = sorted(deduped.values(), key=lambda item: item["published"], reverse=True)
    counts = {kind: sum(item["kind"] == kind for item in items) for kind in ("debris", "spacenews", "techport", "news")}
    missing = [kind for kind, count in counts.items() if count == 0]
    if missing:
        raise SystemExit(f"refusing to build an incomplete payload; empty kinds: {', '.join(missing)}")

    payload = {
        "schema": "orbit-copilot-offline-news-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "month": args.month,
        "date_from": date_from,
        "date_to": args.date_to,
        "counts": counts,
        "items": items,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    args.output.write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    args.output.with_name(args.output.name + ".sha256").write_text(f"{digest}  {args.output.name}\n", encoding="ascii")
    print(json.dumps({"path": str(args.output), "bytes": len(raw), "sha256": digest, "counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
