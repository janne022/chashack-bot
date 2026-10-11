# hermes-pipeline adoption

This repository vendors the runner from `/home/hermes/hermes-pipeline-runtime`
(commit `51adcfebd9e7b4d723f3e55767a2de3e1c017ae4`). The vendored copy and
manifest are the source of local gate behavior; CI adds generic gates after the
existing typecheck, build, tests, and API smoke steps.

Run locally after installing the repository's normal toolchains:

```sh
python3 -m pip install PyYAML==6.0.3
python3 .hermes/pipeline/test_adoption.py
HPIPE_DIFF_SOURCE=origin/main...HEAD python3 .hermes/pipeline/run_gate.py
```

The local runner skips PR-body-only checks when no GitHub event body is supplied.
On pull requests `GITHUB_EVENT_PATH` supplies the body and missing Requirements
or Acceptance headings fail. CI names the PR base-to-HEAD range or push
before-to-HEAD range explicitly; EMPTY means no gates ran, not a successful scan.

To refresh, run the deployed toolkit's `hpipe init --repo .`, review its proposal,
copy only intended updates into `.hermes/pipeline/`, and preserve the source
commit in this document. Never copy from an older checkout of the toolkit.

Future work uses the `chashack-bot` Hermes board and an isolated feature worktree;
use the task's assigned model and runtime bound, request independent `qa-judge`
review on the exact PR head, and leave merge to the operator. A manifest's
`ci.required_checks` is descriptive; it does not configure GitHub branch
protection or automatic merging. The existing Docker publish workflow is
unchanged.
