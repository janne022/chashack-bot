"""Re-run approved pg dependency footprint and OSV comparison; no install or edits."""
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

import yaml

BASE = 'c2af1ae593eb5d3789a8d75f1b8d57d3edbcb871'
old_bytes = subprocess.check_output(['git', 'show', f'{BASE}:pnpm-lock.yaml'])
new_bytes = Path('pnpm-lock.yaml').read_bytes()
old = list(yaml.safe_load_all(old_bytes))[-1]
new = list(yaml.safe_load_all(new_bytes))[-1]
added = sorted(set(new['packages']) - set(old['packages']))
removed = sorted(set(old['packages']) - set(new['packages']))
all_packages = sorted(set(old['packages']) | set(new['packages']))
queries = []
for key in all_packages:
    name, version = key.rsplit('@', 1)
    queries.append({'package': {'name': name, 'ecosystem': 'npm'}, 'version': version})
queries.append({'package': {'name': 'lodash', 'ecosystem': 'npm'}, 'version': '4.17.20'})
request = urllib.request.Request('https://api.osv.dev/v1/querybatch', data=json.dumps({'queries': queries}).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)['results']
assert len(result) == len(queries)
assert result[-1].get('vulns'), 'Known-vulnerable OSV control returned no advisories'
findings = {key: sorted(v['id'] for v in row.get('vulns', [])) for key, row in zip(all_packages, result[:-1]) if row.get('vulns')}
report = {
    'baseline': BASE,
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'lock_sha256': hashlib.sha256(new_bytes).hexdigest(),
    'added_resolutions': {key: new['packages'][key] for key in added},
    'removed_resolutions': removed,
    'added_snapshots': {key: value for key, value in new['snapshots'].items() if key not in old['snapshots']},
    'changed_existing_resolutions': [key for key in old['packages'] if key in new['packages'] and old['packages'][key] != new['packages'][key]],
    'old_osv': {key: value for key, value in findings.items() if key in old['packages']},
    'new_osv': {key: value for key, value in findings.items() if key in new['packages']},
    'known_vulnerable_control': {'package': 'lodash@4.17.20', 'advisories': sorted(v['id'] for v in result[-1]['vulns'])},
    'cooldown_unchanged': subprocess.check_output(['git', 'show', f'{BASE}:pnpm-workspace.yaml']) == Path('pnpm-workspace.yaml').read_bytes(),
}
print(json.dumps(report, indent=2, sort_keys=True))
