#!/usr/bin/env bash
# CI-only negative control: current regressions against the audited defective source.
set -euo pipefail
mkdir -p .audit-evidence
backup=$(mktemp -d)
files=(src/lib/auth.server.ts src/lib/storage.server.ts)
restore() {
  for file in "${files[@]}"; do cp "$backup/$(basename "$file")" "$file"; done
  rm -rf "$backup"
}
trap restore EXIT
for file in "${files[@]}"; do
  cp "$file" "$backup/$(basename "$file")"
  git show ad1c209aaa74a02be1fdd027ae44f20d2d6f8a60:"$file" > "$file"
done
set +e
npm exec -- vitest run src/lib/auth-recovery.test.ts src/lib/generation-admission.test.ts --reporter=json --outputFile=.audit-evidence/baseline.json > .audit-evidence/baseline.log 2>&1
result=$?
set -e
if [[ "$result" != 1 ]]; then cat .audit-evidence/baseline.log; exit 1; fi
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync('.audit-evidence/baseline.json', 'utf8'));
const assertions = report.testResults.flatMap(result => result.assertionResults);
const expected = [
  'retries failed discovery and caches successful discovery for later logins',
  'rejects overlapping work after lease expiry until the running job settles',
  'keeps the room and media while paid work is running beyond lease expiry',
];
for (const name of expected) {
  const test = assertions.find(test => test.title === name);
  const failure = test?.failureMessages.join('\n') ?? '';
  const reason = name.startsWith('retries failed')
    ? /promise rejected.*resolv|Temporary issuer outage/s
    : name.startsWith('rejects overlapping')
      ? /expected true to be false/
      : /promise resolved.*reject/s;
  if (test?.status !== 'failed' || !reason.test(failure))
    throw new Error(`Baseline did not reproduce the intended assertion failure: ${name}`);
}
console.log('All three behavior regressions fail on the audited baseline.');
JS
