#!/usr/bin/env python3
"""Local reranker arm for the Jev catalog eval (plan arm E: cheap local judge).

Scores every candidate of the frozen catalog fixtures with a local Qwen3-Reranker
and writes the same row schema as jev-tool-catalog.mjs so the arms are comparable.
Runs fully offline; no credentials, no network after model download.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

EVIDENCE = Path(__file__).resolve().parents[2] / 'docs/analysis/evidence/2026-09-21-jev'
THRESHOLD = 0.7  # Same demo threshold as the Jev arm; reranker yes-probability is not Noul-calibrated.

INSTRUCTION = (
    'The Document describes a tool capability. Judge whether that capability directly serves '
    'an explicitly requested step in the Query. Judge the whole requested workflow, not only its '
    'first step. Answer yes only when the request explicitly needs the capability; answer no when '
    'it is unrelated, explicitly forbidden, or only an invented possible need.'
)


def build_inputs(tokenizer, query: str, doc: str) -> torch.Tensor:
    # Qwen3-Reranker's chat template reads three roles: system=instruction, query, document.
    messages = [
        {'role': 'system', 'content': INSTRUCTION},
        {'role': 'query', 'content': query},
        {'role': 'document', 'content': doc},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    return tokenizer(text, return_tensors='pt')


def yes_probability(model, tokenizer, query: str, doc: str) -> float:
    inputs = build_inputs(tokenizer, query, doc).to(model.device)
    with torch.no_grad():
        logits = model(**inputs).logits[0, -1]
    yes_id = tokenizer.convert_tokens_to_ids('yes')
    no_id = tokenizer.convert_tokens_to_ids('no')
    pair = torch.softmax(logits[[yes_id, no_id]].float(), dim=0)
    return float(pair[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='Qwen/Qwen3-Reranker-0.6B')
    parser.add_argument('--fixtures', default=str(EVIDENCE / 'catalog-baseline.json'))
    parser.add_argument('--out', required=True)
    parser.add_argument('--limit', type=int, default=0, help='score only the first N cases (smoke test)')
    args = parser.parse_args()

    fixtures = json.loads(Path(args.fixtures).read_text())
    cases = fixtures['cases'] if args.limit <= 0 else fixtures['cases'][:args.limit]
    catalog = fixtures['catalog']
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.float32)
    model.eval()

    rows = []
    total_ms = 0.0
    for index, case in enumerate(cases, 1):
        started = time.perf_counter()
        scored = []
        for entry in catalog:
            doc = f"{entry['name']}: {entry['description']}"
            scored.append({'name': entry['name'], 'score': round(yes_probability(model, tokenizer, case['query'], doc), 4)})
        elapsed_ms = (time.perf_counter() - started) * 1000
        total_ms += elapsed_ms
        scored.sort(key=lambda item: item['score'], reverse=True)
        selected = [item['name'] for item in scored if item['score'] >= THRESHOLD]
        exact = sorted(selected) == sorted(case['expected'])
        rows.append({**{k: case[k] for k in ('id', 'query', 'expected', 'category')},
                     'scored': scored, 'selected': selected, 'exactSet': exact, 'elapsedMs': round(elapsed_ms, 1)})
        print(f"[{index}/{len(cases)}] {case['id']}: exact={exact} selected={len(selected)} ({elapsed_ms/1000:.1f}s)", flush=True)

    exact_sets = sum(1 for row in rows if row['exactSet'])
    empty = sum(1 for row in rows if not row['selected'])
    elapsed = [row['elapsedMs'] for row in rows]
    output = {
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'kind': 'local_reranker_arm_not_P0',
        'model': args.model,
        'device': 'cpu',
        'threshold': THRESHOLD,
        'fixtures': str(Path(args.fixtures).relative_to(EVIDENCE.parents[1])),
        'fixtureHash': fixtures['fixtureHash'],
        'catalogSize': fixtures['catalogSize'],
        'scope': fixtures.get('baselineScope'),
        'networkRequests': 0,
        'totalMs': round(total_ms, 1),
        'summary': {
            'total': len(rows),
            'exactSets': exact_sets,
            'emptySelections': empty,
            'elapsedMsMedian': statistics.median(elapsed),
            'elapsedMsMax': max(elapsed),
            'estimatedKwh': None,
        },
        'rows': rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(output['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
