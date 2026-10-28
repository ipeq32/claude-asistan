# Changelog

## 0.3.0 — 2026-10-28

### Added

- English interface beside Turkish (`/dil`, Settings → Language); an English README.
- The mod's own model calls can run on a local Ollama model (Settings), so
  prompts and replies stay on the machine.
- Vulnerability check: an installed version with known vulnerabilities is
  flagged with its fixed version (OSV); `/zafiyet` checks every pinned
  dependency in `package-lock.json` and `requirements.txt`.
- Git history scan for leaked keys and committed sensitive files (`/gecmis-tara`);
  `git push` stops when the commits to push hold a key.
- `CLAUDE.md` check: after each turn, what the agent did is compared with the
  project's rules; a project without one gets a hint to run `/init`.
- Cost estimate of the draft while typing.
- Team templates in `.asistan/sablonlar.json` (`/sablon paylas`).
- Timeline tab: slowest calls, recent calls, costliest turns.
- Telegram and Discord notifications (`/bildirim`).
- Settings export and import (`/ayar-aktar`).
- CI: validate and test on every push.

## 0.2.0 — 2026-10-28

First public release: the pane with Summary, Prompt, Security, Code, Glossary
and Settings tabs; key, sensitive file, package, network and git guards;
prompt improving; cost, budget and efficiency tracking; changed files with
revert; tests; tasks; weekly report.
