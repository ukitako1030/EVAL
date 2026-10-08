#!/usr/bin/env python3
"""Import historical monthly Chatbot Arena (LMArena) *overall text* ratings, 2023-05 -> 2025-08.

Why: the current HF dataset `lmarena-ai/leaderboard-dataset` back-fills history only for
models that are still in Arena's registry (no claude-1/2, bard, gpt-3.5-turbo-0314, ...).
The legacy HF Space `lmarena-ai/arena-leaderboard` (formerly `lmsys/chatbot-arena-leaderboard`
and `lmarena-ai/chatbot-arena-leaderboard`; the old ids 307-redirect here) still holds every
dated `elo_results_YYYYMMDD.pkl` it ever served (2023-05-08 .. 2025-08-29) plus
`leaderboard_table_YYYYMMDD.csv` model metadata (2023-06-19 .. 2025-08-04).

What it does (idempotent; re-running produces the same file):
  1. lists the Space files via the HF API,
  2. for every calendar month picks the LAST dated pickle of that month,
  3. downloads it (cached; skipped when already present with the right size),
  4. extracts the non-style-controlled "Overall" text leaderboard
     (2023 flat format -> elo_rating_median; 2024+ -> [text.]full.leaderboard_table_df.rating),
     keeping only models with > 300 votes when vote counts exist (same filter the old UI used),
  5. joins Organization from the leaderboard_table CSV of the same date
     (else the nearest earlier CSV, else any CSV that knows the key, else FALLBACK_ORG),
  6. writes pipeline/raw/arena-legacy/<date>.json, one item per line (same layout as
     pipeline/src/raw/store.ts saveSnapshot).

Pickles are loaded with a restricted unpickler: only pandas/numpy/datetime/builtins
container classes are resolved; everything else (plotly figures, anything unexpected,
including os/subprocess-style callables) is replaced by an inert stub. So plotly is NOT needed.

Requirements (pip):
    pip install "pandas>=2.0" "numpy>=1.24"
Usage:
    python pipeline/scripts/import_arena_legacy.py [--date YYYY-MM-DD] [--from 2023-05] [--to 2025-08]
           [--cache DIR] [--out-root pipeline/raw] [--min-votes 300] [--revision <sha>|main]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pickle
import re
import sys
import tempfile
import time
import urllib.request
import warnings
from pathlib import Path

import pandas as pd

SPACE = "lmarena-ai/arena-leaderboard"
# Pinned commit (2026-02-21; data last added 2025-09-03 "add data for August 2025"). Pinning keeps the
# import reproducible even if the files are later pruned from main. Override with --revision main.
REVISION = "6f2eeeba09bf42144dbc118fe1a8e12e4c533f9d"
TREE_URL = "https://huggingface.co/api/spaces/{space}/tree/{rev}?recursive=true"
FILE_URL = "https://huggingface.co/spaces/{space}/resolve/{rev}/{name}"
SOURCE_ID = "arena-legacy"
PKL_RE = re.compile(r"^elo_results_(\d{8})\.pkl$")
CSV_RE = re.compile(r"^leaderboard_table_(\d{8})\.csv$")
UA = {"User-Agent": "ai-war-pipeline/0.1 (import_arena_legacy.py)"}

# Keys that no leaderboard_table CSV knows: 2023 names later renamed (claude-v1 -> claude-1,
# claude-2 -> claude-2.0, gpt-4 -> gpt-4-0314, ...) and models added after the last CSV (2025-08-04).
# The Space is frozen (last pickle 2025-08-29), so this list is complete. Org strings follow the CSVs.
FALLBACK_ORG = {
    "claude-v1": "Anthropic", "claude-2": "Anthropic", "claude-instant-v1": "Anthropic",
    "claude-opus-4-1-20250805": "Anthropic", "claude-opus-4-1-20250805-thinking-16k": "Anthropic",
    "gpt-4": "OpenAI", "gpt-3.5-turbo": "OpenAI", "gpt-5-chat": "OpenAI", "gpt-5-high": "OpenAI",
    "gpt-5-mini-high": "OpenAI", "gpt-5-nano-high": "OpenAI", "gpt-5-old": "OpenAI",
    "gpt-oss-120b": "OpenAI", "gpt-oss-20b": "OpenAI",
    "dbrx-instruct": "Databricks", "deepseek-v3.1": "DeepSeek", "deepseek-v3.1-thinking": "DeepSeek",
    "glm-4.5v": "Z.ai", "hunyuan-t1-20250711": "Tencent", "mai-1-preview": "Microsoft",
    "mistral-medium-2508": "Mistral", "qwen-max-2025-08-15": "Alibaba", "qwen-vl-max-2025-08-13": "Alibaba",
    "step-1o-turbo-202506": "StepFun", "step-3": "StepFun",
}

# ---------------------------------------------------------------- safe unpickling


class _Inert:
    """Stand-in for any class we refuse to import (plotly figures, ...)."""

    def __init__(self, *a, **k):
        pass

    def __setstate__(self, state):
        pass

    def __call__(self, *a, **k):  # in case a pickle tries to "call" it
        return self


_ALLOWED_BUILTINS = {"slice", "set", "frozenset", "complex", "range", "bytearray", "object",
                     "dict", "list", "tuple", "int", "float", "str", "bytes", "bool"}
_ALLOWED_PREFIXES = ("pandas.core.frame", "pandas.core.series", "pandas.core.indexes.", "pandas.core.internals",
                     "pandas.core.arrays.", "pandas.core.dtypes.", "pandas._libs.",
                     "numpy.core.multiarray", "numpy._core.multiarray", "numpy.dtypes")
_ALLOWED_EXACT = {("numpy", "dtype"), ("numpy", "ndarray"), ("collections", "OrderedDict"),
                  ("copyreg", "_reconstructor"), ("datetime", "datetime"), ("datetime", "date"),
                  ("datetime", "timedelta"), ("datetime", "timezone"), ("_codecs", "encode")}


class SafeUnpickler(pickle.Unpickler):
    stubbed: set[str] = set()

    def find_class(self, module: str, name: str):
        ok = ((module == "builtins" and name in _ALLOWED_BUILTINS)
              or (module, name) in _ALLOWED_EXACT
              or module.startswith(_ALLOWED_PREFIXES))
        if ok:
            return super().find_class(module, name)
        SafeUnpickler.stubbed.add(f"{module}.{name}")
        return type(name, (_Inert,), {"__module__": "stub." + module})


def load_pickle(path: Path):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # numpy.core -> numpy._core deprecation noise
        with open(path, "rb") as f:
            return SafeUnpickler(f).load()


# ---------------------------------------------------------------- network


def http_get(url: str, retries: int = 4) -> bytes:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:  # follows 30x redirects
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"GET {url} failed: {last}")


def list_space_files(rev: str) -> dict[str, int]:
    tree = json.loads(http_get(TREE_URL.format(space=SPACE, rev=rev)))
    return {f["path"]: int(f.get("size") or 0) for f in tree if f.get("type") == "file"}


def cached(name: str, size: int, cache: Path, rev: str) -> Path:
    p = cache / name
    if p.exists() and (size <= 0 or p.stat().st_size == size):
        return p
    data = http_get(FILE_URL.format(space=SPACE, rev=rev, name=name))
    if size > 0 and len(data) != size:
        raise RuntimeError(f"{name}: got {len(data)} bytes, expected {size}")
    tmp = p.with_suffix(p.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, p)
    return p


# ---------------------------------------------------------------- extraction


def overall_ratings(res: dict, min_votes: int) -> tuple[dict[str, float], str]:
    """Return {model_key: rating} of the non-style-controlled overall text board + a format tag."""
    cats = res.get("text") if isinstance(res.get("text"), dict) else res
    node = cats.get("full") if isinstance(cats.get("full"), dict) else cats
    where = ("text." if cats is not res else "") + ("full." if node is not cats else "")
    df = node.get("leaderboard_table_df")
    if isinstance(df, pd.DataFrame) and "rating" in df.columns:
        if "num_battles" in df.columns and min_votes > 0:
            df = df[df["num_battles"] > min_votes]
        return {str(k): float(v) for k, v in df["rating"].items()}, where + "leaderboard_table_df.rating"
    for key in ("elo_rating_final", "elo_rating_median", "elo_rating_online"):
        v = node.get(key)
        if isinstance(v, (dict, pd.Series)) and len(v):
            return {str(k): float(x) for k, x in dict(v).items()}, where + key
    raise ValueError("no overall leaderboard found (keys: %s)" % list(node)[:20])


def org_map_from_csv(path: Path) -> dict[str, str]:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    if "key" not in df.columns or "Organization" not in df.columns:
        return {}
    return {k.strip(): o.strip() for k, o in zip(df["key"], df["Organization"]) if k.strip() and o.strip()}


# ---------------------------------------------------------------- main


def num(v: float):
    v = round(v, 1)
    return int(v) if float(v).is_integer() else v


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="snapshot file date (default: today)")
    ap.add_argument("--from", dest="start", default="2023-05", help="first month YYYY-MM")
    ap.add_argument("--to", dest="end", default="9999-12", help="last month YYYY-MM (default: last available)")
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "ai-war-arena-legacy-cache"))
    ap.add_argument("--out-root", default=str(Path(__file__).resolve().parents[1] / "raw"))
    ap.add_argument("--revision", default=REVISION, help="Space git revision (default: pinned sha; or 'main')")
    ap.add_argument("--min-votes", type=int, default=300, help="drop models with <= N votes (0 = keep all)")
    a = ap.parse_args()

    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    files = list_space_files(a.revision)

    pkls = sorted((m.group(1), n) for n in files if (m := PKL_RE.match(n)))
    csvs = sorted((m.group(1), n) for n in files if (m := CSV_RE.match(n)))
    if not pkls:
        print("no elo_results_*.pkl found in the Space", file=sys.stderr)
        return 1

    # last pickle of each calendar month within [start, end]
    per_month: dict[str, tuple[str, str]] = {}
    for d, n in pkls:
        ym = f"{d[:4]}-{d[4:6]}"
        if a.start <= ym <= a.end:
            per_month[ym] = (d, n)  # sorted ascending -> last one wins

    # CSV metadata: the latest CSV on/before each pickle date, plus the newest CSV as global fallback
    need_csv: set[str] = set()
    for d, _ in per_month.values():
        earlier = [c for c in csvs if c[0] <= d]
        if earlier:
            need_csv.add(earlier[-1][1])
    if csvs:
        need_csv.add(csvs[-1][1])
    csv_maps = {CSV_RE.match(n).group(1): org_map_from_csv(cached(n, files[n], cache, a.revision)) for n in sorted(need_csv)}
    global_org: dict[str, str] = {}
    for d in sorted(csv_maps):  # newer CSVs override older ones
        global_org.update(csv_maps[d])

    items: list[dict] = []
    report = []
    unmapped: set[str] = set()
    for ym in sorted(per_month):
        d, name = per_month[ym]
        res = load_pickle(cached(name, files[name], cache, a.revision))
        ratings, fmt = overall_ratings(res, a.min_votes)
        local = {}
        for cd in sorted(c for c in csv_maps if c <= d):
            local = csv_maps[cd]  # nearest earlier (or same-date) CSV
        iso = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        rows = []
        for model, val in ratings.items():
            it = {"series": SOURCE_ID, "kind": "elo", "model": model}
            org = local.get(model) or global_org.get(model) or FALLBACK_ORG.get(model)
            if org:
                it["org"] = org
            else:
                unmapped.add(model)
            it.update({"date": iso, "dateKind": "snapshot", "value": num(val)})
            rows.append(it)
        rows.sort(key=lambda r: (-r["value"], r["model"]))
        items.extend(rows)
        report.append((ym, iso, len(rows), fmt, rows[0]["model"] if rows else "-"))

    out_dir = Path(a.out_root) / SOURCE_ID
    out_dir.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(json.dumps(it, ensure_ascii=False, separators=(",", ":")) for it in items)
    text = f'{{"sourceId":{json.dumps(SOURCE_ID)},"date":{json.dumps(a.date)},"items":[\n{body}\n]}}\n'
    out = out_dir / f"{a.date}.json"
    tmp = out.with_suffix(".json.part")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, out)

    print(f"{'month':8} {'pickle':10} {'rows':>4}  {'leader':28} source")
    for ym, iso, n, fmt, top in report:
        print(f"{ym:8} {iso:10} {n:>4}  {top:28} {fmt}")
    print(f"\nmonths covered: {len(report)} ({report[0][0]} .. {report[-1][0]}); rows: {len(items)}; "
          f"distinct models: {len({i['model'] for i in items})}")
    print(f"models without organization: {len(unmapped)}" + (f" -> {sorted(unmapped)}" if unmapped else ""))
    if SafeUnpickler.stubbed:
        print(f"stubbed (not imported) pickle classes: {sorted(SafeUnpickler.stubbed)}")
    print(f"space: {SPACE}@{a.revision}")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KiB); cache: {cache}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
