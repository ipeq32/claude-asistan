# asistan — a side pane for Claude Code

[Türkçe](README.tr.md)

A Claude Code mod that keeps a pane beside the chat. It guards your keys, your
dependencies and your git history, rewrites prompts into clear English (the
reply still comes in your language), tracks cost and efficiency, and gathers
changed files, tests, a timeline and a glossary in one place. The interface
speaks Turkish and English (`/dil en`).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install asistan --marketplace ipeq32/claude-asistan
```

Answer `y` to add the marketplace, then pick the `user` scope. From a shell:

```
claude plugin install asistan --marketplace ipeq32/claude-asistan
```

In the desktop app: + next to the prompt box → Plugins → Add marketplace
(`ipeq32/claude-asistan`) → Add plugin.

## The pane

It opens by itself in a terminal 144 columns wide or more; otherwise `/asistan`.
Keys `1`–`7` switch tabs once the pane holds the keyboard.

1. **Summary** — efficiency score (0–100) with a 14-day trend, cache / context /
   failure rates, rate limits, session / day / project cost, a 7-day chart,
   spend per project, tasks, test status, a summary of the last turn, running
   subagents, the weekly report and tips.
2. **Prompt** — the improved prompt's quality score, what it lacked and what the
   rewrite added; what you wrote / what was sent / its translation; searchable
   history; personal and team templates.
3. **Security** — whether `.env` files are tracked or ignored; every guard's
   switch; dependency vulnerabilities (OSV); keys in git history; checked
   packages; domains reached; an event log.
4. **Code** — files changed this session with their diff and one-click revert;
   tests; the last error and an explanation; a commit message suggestion; copy
   buttons for the code blocks of the last reply.
5. **Timeline** — the slowest tool calls, recent calls with their duration, the
   costliest turns.
6. **Glossary** — English technical terms from the replies, explained.
7. **Settings** — language, the mod's own model (Haiku or a local Ollama model),
   notifications (desktop, sound, read aloud, Telegram / Discord), every
   feature's switch, daily and project budgets, export / import.

## Prompt improving

- A prompt that starts with `++` is rewritten into a clear English prompt and
  sent that way; Claude is asked to reply in the language you wrote in.
- **✨ Improve** above the prompt box swaps the draft for the rewrite, so you
  read it before pressing Enter.
- `/prompt-modu her-zaman` improves every prompt.
- While you type, the band shows roughly how many tokens the draft is and what
  a turn has cost on average.

## Guards

- A key pasted into the prompt box turns red as you type; on send it warns,
  masks or blocks (`/anahtar-koruma`).
- Keys and `.env` values in tool output are masked before the model reads them.
- `git add` / `commit` / `push` stop when they would add or publish a sensitive
  file or a key.
- Optionally, no access at all to `.env` files, SSH keys, `.pem` files, cloud
  credentials and the like.
- Packages installed with `npm / pnpm / yarn / bun / pip / uv / poetry` are
  looked up first: a package that does not exist (often made up by a model) or
  that looks like a popular one while being new or little used is stopped; a
  version with known vulnerabilities is flagged with the fixed version.
- `/zafiyet` checks every pinned dependency (`package-lock.json`,
  `requirements.txt`) against OSV; `/gecmis-tara` searches all of git history
  for leaked keys.
- Risky commands (`rm -rf`, `git push --force` …) and new domains are reported.
- After each turn, what the agent did is compared with the project's
  `CLAUDE.md`; a project without one gets a hint to run `/init`.

## Commands

| Command | What it does |
| --- | --- |
| `/asistan` | Opens the pane |
| `/iyilestir <text>` | Improves the text and puts it in the box |
| `/prompt-modu [onek\|her-zaman]` | When prompts are improved |
| `/anahtar-koruma [uyar\|maskele\|engelle]` | What a key in a prompt does |
| `/guvenlik` | Rescans `.env` files |
| `/zafiyet` | Checks dependencies for known vulnerabilities |
| `/gecmis-tara` | Searches git history for keys |
| `/ozet` | Session summary |
| `/rapor` | Report of the last 7 days |
| `/sablon [<name>\|kaydet\|sil\|paylas]` | Templates; `paylas` writes `.asistan/sablonlar.json` for the team |
| `/butce [<usd>\|kapat\|uyar\|durdur\|proje <usd>]` | Daily and project budgets |
| `/test-komutu [<command>\|sil]` | The project's test command |
| `/bildirim [test\|ac\|kapat]` | Telegram / Discord notifications |
| `/ayar-aktar [disa\|ice] [path]` | Settings, templates and glossary to and from a file |
| `/dil [tr\|en]` | Interface language |

## Notifications on your phone

Fill `telegramBotToken` + `telegramChatId` or `discordWebhookUrl` when the
plugin is installed (or in its settings), or set `ASISTAN_TELEGRAM_TOKEN`,
`ASISTAN_TELEGRAM_CHAT_ID`, `ASISTAN_DISCORD_WEBHOOK`. Then `/bildirim ac` and
`/bildirim test`.

## Worth knowing

- Improving, the turn digest, error explanations, commit suggestions and model
  hints are each one small model call, billed to the session's credentials.
  With a local Ollama model chosen in Settings they never leave the machine, and
  a failed local call is not retried on Haiku.
- Package, vulnerability and history checks call npm, PyPI and OSV; without a
  network an install is not stopped.
- Revert writes back a file as it was before this session's first edit of it.
  A reload of the mod loses those snapshots; the diff then comes from git.
- Desktop notifications use `notify-send`, sound `paplay` (Linux); otherwise
  Claude Code's own notification is used.
- The mod API is early access and may change between Claude Code releases.

## Development

```
claude --plugin-dir ./
claude plugin validate ./
claude plugin test ./
```

Changes are listed in [CHANGELOG.md](CHANGELOG.md). License: MIT.
