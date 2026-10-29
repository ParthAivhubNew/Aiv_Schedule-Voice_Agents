"""The company test from the plan: run the real lookup on companies whose right answer is known, then judge it.

    cd backend
    python -m scripts.search_eval cases.csv --out run.json                    # runs the real lookup (needs the search keys and the database)
    python -m scripts.search_eval cases.csv --out run.json --style sentence    # same companies, a different first query, to compare styles
    python -m scripts.search_eval --replay run.json                           # no searching: re-judge a saved run at other thresholds

cases.csv columns:  name, region, postcode, industry, status, case, expected_website, expected_phone, expected_email
  case is one of: normal, common_name, trading_name, closed, no_website. Leave an expected_* empty when the company has none: a value
  shown for it then counts as WRONG. status is the register's status ("active" if empty). Use 30 companies to tune the threshold and
  margin, then a fresh 50 to confirm; the hard cases (common names, trading names, closed, no website) belong in both sets.

The report has, per field: answers shown, right, wrong, and the hit rate over companies that really have a value. "No wrong answer"
needs zero wrong; with N shown and none wrong, the true error rate is probably under 3/N (95% confidence). It also prints credits per
outcome, the cost per shown answer, and a threshold/margin sweep from the saved evidence (the lowest wrong count, then the highest hit rate).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

FIELDS = ("website", "phone", "email")


def _norm(field: str, value: str) -> str:
    from app.services import guardrail as G

    v = str(value or "").strip().lower()
    if field == "website":
        return G.registered_domain(v) if v else ""
    if field == "phone":
        return G.national(v) if v else ""
    return v


def judge(case: Dict[str, str], shown: Dict[str, str]) -> Dict[str, str]:
    """Per field: right | wrong | missed | false_shown | correct_nothing | not_checked. A closed company, or one with no website, must show
    nothing at all (anything shown is false_shown); otherwise a field is judged only when its expected value is given."""
    out = {}
    for f in FIELDS:
        wants = {_norm(f, v) for v in str(case.get(f"expected_{f}") or "").split("|") if v.strip()}  # a company may have more than one right answer
        got = _norm(f, shown.get(f) or "")
        want = got if got in wants else (sorted(wants)[0] if wants else "")
        if case.get("case") in ("closed", "no_website"):
            out[f] = "false_shown" if got else "correct_nothing"
        elif want:
            out[f] = "right" if got == want else ("wrong" if got else "missed")
        else:
            out[f] = "not_checked"
    return out


def redecide(audit: List[Dict[str, Any]], threshold: int, margin: int) -> Dict[str, str]:
    """What would be shown at another threshold and margin, from a saved audit (no searching)."""
    from app.services import guardrail as G

    shown = {}
    for f in FIELDS:
        cands = [{"field": f, "key": a["value"], "value": a["value"], "score": a["score"], "rejected": a["rejected"]} for a in audit if a["field"] == f]
        win, _ = G.decide(cands, threshold, margin)
        shown[f] = win["value"] if win else ""
    return shown


def summarise(rows: List[Dict[str, Any]], threshold: int, margin: int) -> Dict[str, Any]:
    tally: Dict[str, Dict[str, int]] = {f: defaultdict(int) for f in FIELDS}
    for r in rows:
        shown = redecide(r["audit"], threshold, margin)
        for f, verdict in judge(r["case"], shown).items():
            tally[f][verdict] += 1
    return tally


def hit_rate(t: Dict[str, int]) -> float:
    """Right answers over the companies that really have the value: right + wrong (a wrong value shown) + missed."""
    have = t.get("right", 0) + t.get("wrong", 0) + t.get("missed", 0)
    return (t.get("right", 0) / have) if have else 0.0


def sweep(rows: List[Dict[str, Any]]) -> List[Tuple[int, int, int, float]]:
    """(threshold, margin, wrong shown, mean hit rate across fields), best first: no wrong answers, then the most found."""
    results = []
    for th in range(50, 101, 5):
        for mg in range(5, 31, 5):
            tally = summarise(rows, th, mg)
            wrong = sum(t.get("wrong", 0) + t.get("false_shown", 0) for t in tally.values())
            judged = [t for t in tally.values() if t.get("right", 0) + t.get("wrong", 0) + t.get("missed", 0)]  # only fields that had expected values
            rate = sum(hit_rate(t) for t in judged) / len(judged) if judged else 0.0
            results.append((th, mg, wrong, rate))
    return sorted(results, key=lambda x: (x[2], -x[3], x[0]))


def credit_report(rows: List[Dict[str, Any]], price: float, google: float, threshold: int = 70, margin: int = 15) -> List[str]:
    by: Dict[str, List[float]] = defaultdict(list)
    for r in rows:
        led = r.get("ledger") or {}
        by[led.get("outcome", "unknown")].append(float(led.get("tavily_credits", 0)))  # company pages are read by our own fetch, which costs no Tavily credit
    lines = ["credits per outcome (Tavily search credits):"]
    spent = 0.0
    for outcome, vals in sorted(by.items()):
        lines.append(f"   {outcome:14} {len(vals):3} lookups, mean {sum(vals) / len(vals):.2f} credits, max {max(vals):.1f}")
        spent += sum(vals)
    shown = sum(1 for r in rows if any(redecide(r["audit"], threshold, margin).values()))
    lines.append(f"total {spent:.1f} credits = ${spent * price:.2f} at ${price}/credit ({len(rows)} lookups, {shown} showed something)")
    if shown:
        lines.append(f"cost per lookup that showed something: {spent / shown:.2f} credits = ${spent / shown * price:.3f} (Google lookups, if any, cost ${google} each on top)")
    return lines


def report(rows: List[Dict[str, Any]], threshold: int, margin: int, price: float, google: float) -> str:
    out = [f"\nresults at threshold {threshold} and margin {margin}\n"]
    tally = summarise(rows, threshold, margin)
    out.append(f"{'field':8} {'shown':>6} {'right':>6} {'wrong':>6} {'missed':>7} {'hit rate':>9}   upper bound on error (95%)")
    for f in FIELDS:
        t = tally[f]
        bad = t.get("wrong", 0) + t.get("false_shown", 0)
        shown = t.get("right", 0) + bad
        bound = f"under {3 / shown:.0%}" if shown and not bad else ("n/a" if not shown else "wrong answers shown")
        out.append(f"{f:8} {shown:6} {t.get('right', 0):6} {bad:6} {t.get('missed', 0):7} {hit_rate(t):9.0%}   {bound}")
    out.append("\nwrong answers:")
    wrong_any = False
    for r in rows:
        shown = redecide(r["audit"], threshold, margin)
        for f, v in judge(r["case"], shown).items():
            if v in ("wrong", "false_shown"):
                wrong_any = True
                out.append(f"   {r['case'].get('name')} [{r['case'].get('case')}] {f}: shown {shown[f]!r}, expected {r['case'].get('expected_' + f)!r}")
    if not wrong_any:
        out.append("   none")
    out += [""] + credit_report(rows, price, google, threshold, margin)
    out.append("\nthreshold/margin sweep (wrong shown, then hit rate), best first:")
    for th, mg, wrong, rate in sweep(rows)[:8]:
        out.append(f"   threshold {th:3} margin {mg:2}: wrong {wrong}, hit rate {rate:.0%}")
    return "\n".join(out)


def _style_plan(style: str):
    from app.services import search_recipe as R

    if style == "recipe":
        return None

    def plan(facts: Dict[str, Any]) -> List[Dict[str, Any]]:
        name, area = R.plain_name(facts.get("name") or ""), R.area_of(facts.get("region") or "", facts.get("postcode") or "")
        first = {"sentence": f"could you please find me a website for {name.lower()} which is located in {area}",
                 "keyword": f"{name} {facts.get('postcode') or area}"}[style]
        base = R.plan(facts)
        return [{"want": "website", "query": first, "retry": False}] + base[1:]
    return plan


async def run_live(cases: List[Dict[str, str]], style: str, out: Optional[str] = None, want: str = "website",
                   max_credits: float = 0.0) -> List[Dict[str, Any]]:
    from app.services import search_recipe as R
    from app.services import web_harness as H

    alt = _style_plan(style)
    if alt:
        R.plan = alt  # the harness calls R.plan, so only the first query changes
    rows = []
    spent = 0.0
    for i, case in enumerate(cases, 1):
        if max_credits and spent + 2 > max_credits:  # a company normally costs 1 to 2 credits: stop before the cap is passed
            print(f"stopped at {len(rows)} companies: {spent:.0f} of {max_credits:.0f} credits used", file=sys.stderr)
            break
        facts = {"postcode": case.get("postcode", ""), "industry": case.get("industry", ""), "status": case.get("status", "") or "active",
                 "phone": case.get("known_phone", ""), "email": case.get("known_email", "")}  # what our own records already hold for the company
        got = await H.find_company(None, name=case["name"], place=case.get("region", ""), facts=facts, want=want)
        shown = {"website": got["website"], "phone": (got["phones"] or [""])[0], "email": (got["emails"] or [""])[0]}
        rows.append({"case": case, "shown": shown, "audit": got["audit"], "ledger": got["ledger"], "reason": got["reason"]})
        spent += float(got["ledger"].get("tavily_credits", 0))
        print(f"[{i}/{len(cases)}] {case['name']}: {shown}", file=sys.stderr)
        if out:  # saved after every company, so stopping a long run keeps what it has done
            json.dump(rows, open(out, "w", encoding="utf-8"), indent=1)
    return rows


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cases", nargs="?", help="the CSV of companies")
    ap.add_argument("--replay", help="a saved run (json) to re-judge without searching")
    ap.add_argument("--out", help="where to save a live run")
    ap.add_argument("--style", choices=["recipe", "sentence", "keyword"], default="recipe", help="the first query's style")
    ap.add_argument("--limit", type=int, help="run only the first N companies")
    ap.add_argument("--max-credits", type=float, default=0.0, help="stop before this many Tavily credits are spent")
    ap.add_argument("--want",choices=["website", "phone", "all"], default="website", help="what to search for, as the Find buttons do")
    ap.add_argument("--threshold", type=int, default=70)
    ap.add_argument("--margin", type=int, default=15)
    ap.add_argument("--credit-price", type=float, default=0.008, help="dollars per Tavily credit")
    ap.add_argument("--google-price", type=float, default=0.035)
    a = ap.parse_args(argv)
    if a.replay:
        rows = json.load(open(a.replay, encoding="utf-8"))
    elif a.cases:
        with open(a.cases, newline="", encoding="utf-8") as fh:
            cases = list(csv.DictReader(fh))
        rows = asyncio.run(run_live(cases[:a.limit] if a.limit else cases, a.style, a.out, a.want, a.max_credits))
    else:
        ap.error("give a CSV of companies, or --replay a saved run")
    print(report(rows, a.threshold, a.margin, a.credit_price, a.google_price))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
