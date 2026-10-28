// What the hooks and the drawings do through `$`.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  AsistanSettings,
  ChangedFile,
  CodeBlock,
  EnvStatus,
  HistoryItem,
  Lang,
  NetRow,
  PackageCheck,
  ProjectCost,
  PromptRecord,
  SecurityEvent,
  TaskRow,
  Template,
  Term,
  Tip,
  WeeklyReport,
} from '../types'
import { complete, osvQuery, pushProblems, sendRemote } from './extra'
import {
  DAY_MS,
  DEFAULT_SETTINGS,
  ENV_EXAMPLE,
  ENV_NAME,
  addedLines,
  average,
  dayKey,
  domainOf,
  findSecrets,
  gitOps,
  isCommitAll,
  isKnownDomain,
  isSensitivePath,
  langName,
  lookalikeOf,
  maskSecrets,
  parseImproved,
  parseInstalls,
  parseJson,
  projectOf,
  resolveDir,
  say,
  shellQuote,
  short,
} from './lib'
import type { Improved } from './lib'
import { DEFAULT_SETTINGS as ATOM_DEFAULT_SETTINGS, EMPTY_METRICS as ATOM_EMPTY_METRICS } from './lib'

// The state this file reads and writes. The scan that lists a mod's state
// takes atoms only from the file that reads them, so each file declares the
// atoms it uses: keep the copies alike (same key, initial value and shape tag
// in every file). Change a shape tag when that value's fields change; it
// declines what an earlier version stored, which outlives a reload.
const settingsAtom = atom({ plugin: 'asistan', key: 'settings' } as const, ATOM_DEFAULT_SETTINGS, { shape: 'settings-3' })
const lastPromptAtom = atom({ plugin: 'asistan', key: 'lastPrompt' } as const, null, { shape: 'prompt-3' })
const tipsAtom = atom({ plugin: 'asistan', key: 'tips' } as const, [], { shape: 'tips-1' })
const metricsAtom = atom({ plugin: 'asistan', key: 'metrics' } as const, ATOM_EMPTY_METRICS, { shape: 'metrics-3' })
const trendsAtom = atom({ plugin: 'asistan', key: 'trends' } as const, { quality: [], score: [] }, { shape: 'trends-1' })
const envAtom = atom({ plugin: 'asistan', key: 'env' } as const, { isChecked: false, files: [], tracked: [], unignored: [] }, { shape: 'env-1' })
const eventsAtom = atom({ plugin: 'asistan', key: 'events' } as const, [], { shape: 'events-1' })
const lastErrorAtom = atom({ plugin: 'asistan', key: 'lastError' } as const, null, { shape: 'error-1' })
const agentsAtom = atom({ plugin: 'asistan', key: 'agents' } as const, [], { shape: 'agents-1' })
const templatesAtom = atom({ plugin: 'asistan', key: 'templates' } as const, [], { shape: 'templates-1' })
const historyAtom = atom({ plugin: 'asistan', key: 'history' } as const, [], { shape: 'history-1' })
const changedFilesAtom = atom({ plugin: 'asistan', key: 'changedFiles' } as const, [], { shape: 'files-1' })
const diffViewAtom = atom({ plugin: 'asistan', key: 'diffView' } as const, null, { shape: 'diff-1' })
const testsAtom = atom({ plugin: 'asistan', key: 'tests' } as const, null, { shape: 'tests-1' })
const tasksAtom = atom({ plugin: 'asistan', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const networkAtom = atom({ plugin: 'asistan', key: 'network' } as const, [], { shape: 'net-1' })
const packagesAtom = atom({ plugin: 'asistan', key: 'packages' } as const, [], { shape: 'packages-1' })
const glossaryAtom = atom({ plugin: 'asistan', key: 'glossary' } as const, [], { shape: 'glossary-1' })
const busyAtom = atom({ plugin: 'asistan', key: 'busy' } as const, null)
const turnSummaryAtom = atom({ plugin: 'asistan', key: 'turnSummary' } as const, null)
const commitSuggestionAtom = atom({ plugin: 'asistan', key: 'commitSuggestion' } as const, null)
const confirmRevertAtom = atom({ plugin: 'asistan', key: 'confirmRevert' } as const, null)
const projectBudgetAtom = atom({ plugin: 'asistan', key: 'projectBudget' } as const, null)

const SOUND = '/usr/share/sounds/freedesktop/stereo/complete.oga'

async function langOf($: EngineInterface): Promise<Lang> {
  return (await read($, settingsAtom)).language
}

// ---- small state helpers --------------------------------------------------------

export function addTip($: EngineInterface, tip: Tip) {
  return update($, tipsAtom, list => [...list.filter(one => one.id !== tip.id), tip].slice(-6))
}

export function dropTip($: EngineInterface, id: string) {
  return update($, tipsAtom, list => (list.some(one => one.id === id) ? list.filter(one => one.id !== id) : list))
}

export async function logEvent($: EngineInterface, text: string) {
  const event: SecurityEvent = { text, at: await $.clock.now() }
  await update($, eventsAtom, list => [...list, event].slice(-5))
}

export function setBusy($: EngineInterface, label: string | null) {
  return update($, busyAtom, () => label)
}

export async function changeSettings($: EngineInterface, change: (old: AsistanSettings) => AsistanSettings) {
  const value = await update($, settingsAtom, change)
  await $.store.set('settings', value)
  await refreshStatus($)
  return value
}

export async function loadSettings($: EngineInterface) {
  const stored = await $.store.get('settings')
  const value: AsistanSettings = {
    ...DEFAULT_SETTINGS,
    ...(typeof stored === 'object' && stored !== null ? (stored as Partial<AsistanSettings>) : {}),
  }
  // What version 0.1 kept under keys of their own.
  const oldSecret = await $.store.get('secretMode')
  if (stored === undefined && (oldSecret === 'warn' || oldSecret === 'mask' || oldSecret === 'block')) {
    value.secretMode = oldSecret
  }
  const oldImprove = await $.store.get('improveMode')
  if (stored === undefined && (oldImprove === 'prefix' || oldImprove === 'always')) {
    value.improveMode = oldImprove
  }
  await update($, settingsAtom, () => value)
  const templates = await $.store.get('templates')
  if (Array.isArray(templates)) {
    const list = templates.filter(
      (one): one is Template =>
        typeof one === 'object' && one !== null && typeof one.name === 'string' && typeof one.text === 'string',
    )
    await update($, templatesAtom, () => list)
  }
  const history = await $.store.get('history')
  if (Array.isArray(history)) await update($, historyAtom, () => history as HistoryItem[])
  const glossary = await $.store.get('glossary')
  if (Array.isArray(glossary)) await update($, glossaryAtom, () => glossary as Term[])
  const project = projectOf(await $.session.cwd())
  const budget = await $.store.get(`proj-budget:${project}`)
  await update($, projectBudgetAtom, () => (typeof budget === 'number' ? budget : null))
}

export async function saveTemplates($: EngineInterface, change: (old: Template[]) => Template[]) {
  const list = await update($, templatesAtom, change)
  await $.store.set('templates', list)
  return list
}

export async function fillTemplate($: EngineInterface, template: Template) {
  await $.prompt.fill({ text: template.text, mode: 'replace' })
  $.ui.toast(say(await langOf($), `Şablon "${template.name}" kutuya yazıldı.`, `Template "${template.name}" is in the box.`))
}

export async function refreshStatus($: EngineInterface) {
  const m = await read($, metricsAtom)
  const s = await read($, envAtom)
  const set = await read($, settingsAtom)
  const problems = s.tracked.length + s.unignored.length
  const score = m.score === null ? '—' : String(m.score)
  const lock = !s.isChecked ? '🔐 …' : problems === 0 ? '🔐 ✓' : `🔐 ⚠${problems}`
  const budget =
    set.budgetUsd !== null && m.todayUsd !== null ? ` · 💰 $${m.todayUsd.toFixed(2)}/$${set.budgetUsd}` : ''
  const local = set.modelProvider === 'ollama' ? ' · 🏠' : ''
  $.ui.status(`📊 ${score}/100 · ${lock}${budget}${local} · ++ ${say(set.language, 'iyileştir', 'improve')}`)
}

// ---- model calls -------------------------------------------------------------------

const improverSystem = (lang: Lang) => `You rewrite a developer's request for Claude Code, an AI coding agent that works in their terminal.
The request may be in any language. Produce a clear, specific English prompt for the agent.
Rules:
- Keep every fact, file path, command, code snippet, identifier, name and URL exactly as written.
- Do not invent requirements, files, technologies or constraints. Do not answer or perform the request.
- Where the request is vague, make it precise only as far as the original implies: the goal, the relevant context, constraints and the expected result.
- Keep short requests short; use a short list only when the request has several parts.
- Placeholders like [GİZLİ: ...] stay exactly as they are.
Also rate the ORIGINAL request: how clear and actionable it is for a coding agent, 0-10, and list what it lacks (goal, target files, expected result, constraints, error message...) as short ${langName(lang)} phrases; an empty list when nothing is missing. And list what your rewrite made explicit that the original left implicit, as short ${langName(lang)} phrases.
Return only JSON, no code fence:
{"en": "<the English prompt>", "tr": "<a faithful ${langName(lang)} translation of your English prompt>", "score": <0-10>, "missing": ["<short phrase>", ...], "added": ["<short phrase>", ...]}`

export async function improve($: EngineInterface, text: string): Promise<Improved | null> {
  const reply = await complete($, improverSystem(await langOf($)), `<request>\n${text}\n</request>`, 2048)
  return reply === null ? null : parseImproved(reply)
}

export const languageNote = (original: string) =>
  "The prompt above was rewritten in English from the user's original request below. " +
  'Reply to the user in the language of that original request; keep code, commands and identifiers as they are.\n' +
  `Original request:\n${original}`

export async function recordImproved($: EngineInterface, original: string, improved: Improved, isPending: boolean) {
  const record: PromptRecord = {
    original,
    en: improved.en,
    tr: improved.tr,
    quality: improved.quality,
    missing: improved.missing,
    added: improved.added,
    isPending,
    at: await $.clock.now(),
  }
  await update($, lastPromptAtom, () => record)
  if (improved.quality !== null) await addSample($, 'quality-day', record.at, improved.quality)
  await refreshTrends($, record.at)
  return record
}

export async function improveDraft($: EngineInterface, draft: string) {
  const lang = await langOf($)
  const text = draft.replace(/^\+\+\s*/, '').trim()
  if (!text) {
    $.ui.toast(say(lang, 'Önce kutuya bir prompt yaz.', 'Type a prompt in the box first.'))
    return
  }
  await setBusy($, say(lang, '⏳ Prompt iyileştiriliyor…', '⏳ Improving the prompt…'))
  const improved = await improve($, maskSecrets(text)).catch(() => null)
  await setBusy($, null)
  if (!improved) {
    $.ui.toast(say(lang, 'İyileştirme başarısız oldu, prompt değişmedi.', 'Improving failed; the prompt is unchanged.'))
    return
  }
  await recordImproved($, text, improved, true)
  await $.prompt.fill({ text: improved.en, mode: 'replace' })
  const quality = improved.quality === null ? '' : say(lang, ` Kalite: ${improved.quality}/10.`, ` Quality: ${improved.quality}/10.`)
  $.ui.toast(
    say(lang, `İyileştirildi.${quality} Türkçesi panelde, göndermek için Enter.`, `Improved.${quality} Press Enter to send.`),
  )
}

// One turn digested in one call: a summary, new technical terms with their
// meaning, and anything done against the project's CLAUDE.md rules.
export async function digestTurn(
  $: EngineInterface,
  answer: string,
  actions: string[],
  wants: { summary: boolean; terms: boolean; rules: string | null },
) {
  const lang = await langOf($)
  const known = (await read($, glossaryAtom)).map(one => one.term.toLowerCase())
  const done = actions.length ? `What the agent did this turn:\n${actions.slice(-40).join('\n')}\n\n` : ''
  const rules = wants.rules ? `Project rules (CLAUDE.md):\n${wants.rules}\n\n` : ''
  const text = await complete(
    $,
    `You help a ${langName(lang)}-speaking developer follow an AI coding agent. Return only JSON, no code fence:
{"summary": "<at most two short ${langName(lang)} lines on what was done in the turn: changes made, things found; not a restatement of advice>",
 "terms": [{"term": "<an English technical term the reply uses>", "tr": "<its meaning in ${langName(lang)}, at most 12 words>"}],
 "violations": ["<a short ${langName(lang)} line naming a project rule the agent's actions seem to break, and how>"]}
Terms: at most 3, only ones a developer might not know; skip everyday words (file, function, commit, test, bug) and these known ones: ${known.slice(-60).join(', ') || 'none'}.
Violations: only clear ones against the rules given; an empty list when there are no rules or nothing breaks them.`,
    `${rules}${done}Final reply of the turn:\n${short(answer, 6000)}`,
    700,
  )
  const value = text === null ? null : parseJson(text)
  if (value === null) return null
  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''
  if (wants.summary && summary) await update($, turnSummaryAtom, () => summary)
  if (wants.terms && Array.isArray(value.terms)) {
    const terms = value.terms
      .filter(
        (one): one is Term =>
          typeof one === 'object' && one !== null && typeof one.term === 'string' && typeof one.tr === 'string',
      )
      .filter(one => !known.includes(one.term.toLowerCase()))
    if (terms.length) {
      const list = await update($, glossaryAtom, old => [...old, ...terms].slice(-150))
      await $.store.set('glossary', list)
    }
  }
  const violations = Array.isArray(value.violations)
    ? value.violations.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : []
  if (wants.rules && violations.length) {
    await addTip($, { id: 'rules', level: 'warn', text: `📏 CLAUDE.md: ${violations.slice(0, 2).join(' · ')}` })
  } else {
    await dropTip($, 'rules')
  }
  return summary || null
}

export async function explainError($: EngineInterface) {
  const error = await read($, lastErrorAtom)
  if (error === null) return
  const lang = await langOf($)
  await setBusy($, say(lang, '⏳ Hata açıklanıyor…', '⏳ Explaining the error…'))
  const text = await complete(
    $,
    `Explain a failed shell command to a ${langName(lang)}-speaking developer. In ${langName(lang)}, at most five short lines: what the error means, the likely cause, and a concrete fix. No preamble, no markdown headings.`,
    `Command:\n${error.command}\n\nOutput:\n${short(error.output, 6000)}`,
    500,
  )
  await setBusy($, null)
  await update($, lastErrorAtom, old => old && { ...old, explanation: text ?? say(lang, 'Açıklama alınamadı.', 'No explanation came back.') })
}

export async function suggestCommit($: EngineInterface) {
  const lang = await langOf($)
  const cwd = await $.session.cwd()
  const git = (args: string[]) => $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 15000 }).catch(() => null)
  const staged = await git(['diff', '--cached', '--stat', '-p'])
  if (staged === null || staged.exitCode !== 0) {
    $.ui.toast(say(lang, 'Burası bir git deposu değil.', 'This is not a git repository.'))
    return
  }
  const isStaged = staged.stdout.trim().length > 0
  const diff = isStaged ? staged.stdout : ((await git(['diff', '--stat', '-p']))?.stdout ?? '')
  if (!diff.trim()) {
    $.ui.toast(say(lang, 'Commit edilecek değişiklik yok.', 'Nothing to commit.'))
    return
  }
  await setBusy($, say(lang, '⏳ Commit mesajı yazılıyor…', '⏳ Writing a commit message…'))
  const message = await complete(
    $,
    'Write one git commit message for this diff in English, Conventional Commits style: a subject line under 72 characters, then optionally a blank line and up to three short "- " bullet lines. Return only the message. Never add co-author, "generated by" or tool attribution lines.',
    short(diff, 20000),
    300,
  )
  await setBusy($, null)
  if (!message) {
    $.ui.toast(say(lang, 'Commit mesajı alınamadı.', 'No commit message came back.'))
    return
  }
  const [subject = '', ...rest] = message.replace(/^```\w*\n?|```$/g, '').trim().split('\n')
  const body = rest
    .filter(line => !/^(co-authored-by|generated (with|by))/i.test(line.trim()))
    .join('\n')
    .trim()
  await update($, commitSuggestionAtom, () => message)
  const flags = isStaged ? '' : '-a '
  const command = `!git commit ${flags}-m ${shellQuote(subject.trim())}${body ? ` -m ${shellQuote(body)}` : ''}`
  await $.prompt.fill({ text: command, mode: 'replace' })
  $.ui.toast(
    isStaged
      ? say(lang, 'Commit komutu kutuya yazıldı, Enter ile çalıştır.', 'The commit command is in the box; Enter runs it.')
      : say(
          lang,
          'Hiçbir şey stage edilmemiş: komut izlenen dosyaları -a ile commit eder.',
          'Nothing is staged: the command commits tracked files with -a.',
        ),
  )
}

export async function modelHint($: EngineInterface, text: string) {
  const model = await $.session.model()
  if (!/opus/i.test(model) || text.trim().length < 8) return
  const label = await complete(
    $,
    'Classify a request to an AI coding agent. Answer with one word: simple (a small edit, rename, formatting, a short factual question, a one-file change) or complex (design, debugging, multi-file work, research).',
    short(text, 2000),
    5,
  )
  if (label?.toLowerCase().startsWith('simple')) {
    await addTip($, {
      id: 'model',
      level: 'info',
      text: say(
        await langOf($),
        'Son istek basit görünüyordu: bu tür işler için /model sonnet daha ucuz ve hızlı.',
        'The last request looked simple: /model sonnet is cheaper and faster for such work.',
      ),
    })
  } else {
    await dropTip($, 'model')
  }
}

// ---- notifications ----------------------------------------------------------------

export async function notifyDesktop($: EngineInterface, title: string, body: string, isSound: boolean) {
  const sent = await $.process
    .run(['notify-send', '-a', 'Claude Code', title, body], { timeoutMs: 5000 })
    .then(run => run.exitCode === 0)
    .catch(() => false)
  if (!sent) await $.ui.notify(body, { title }).catch(() => undefined)
  if (isSound) await $.process.run(['paplay', SOUND], { timeoutMs: 10000 }).catch(() => undefined)
  if ((await read($, settingsAtom)).remoteNotify) await sendRemote($, `${title}\n${body}`)
}

// ---- spend ------------------------------------------------------------------------------

// Today's spend: what turns already booked plus this session's unbooked part.
export async function spendToday($: EngineInterface, lastCost: number | null) {
  const now = await $.clock.now()
  const day = await $.store.get(dayKey(now))
  const cost = (await $.session.usage()).cost?.usd ?? null
  const pending = cost !== null && lastCost !== null && cost > lastCost ? cost - lastCost : 0
  return (typeof day === 'number' ? day : 0) + pending
}

export async function weekDays($: EngineInterface, now: number) {
  const days: number[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const day = await $.store.get(dayKey(now - i * DAY_MS))
    days.push(typeof day === 'number' ? day : 0)
  }
  return days
}

// ---- agents ------------------------------------------------------------------------------

export async function pollAgents($: EngineInterface) {
  const list = await $.agent.list().catch(() => null)
  if (list === null) return
  const rows = list
    .filter(one => one.status === 'running' || one.status === 'pending' || one.status === 'waiting')
    .map(one => ({ id: one.id, label: short(one.name ?? (one.description || one.type), 40), status: one.status }))
  const old = await read($, agentsAtom)
  if (JSON.stringify(old) !== JSON.stringify(rows)) await update($, agentsAtom, () => rows)
}

// ---- .env and git ------------------------------------------------------------------------

// Lists .env files in cwd and its direct children, and asks git whether each
// is tracked (exposed in history) or not ignored (one `git add .` away).
export async function scanEnv($: EngineInterface, cwd: string) {
  const dirs = [cwd]
  const top = await $.fs.list(cwd).catch(() => [])
  for (const entry of top) {
    if (entry.kind === 'dir' && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      dirs.push(`${cwd}/${entry.name}`)
    }
  }
  const found: EnvStatus = { isChecked: true, files: [], tracked: [], unignored: [] }
  for (const dir of dirs.slice(0, 80)) {
    const entries = await $.fs.list(dir).catch(() => [])
    const names = entries
      .filter(one => one.kind === 'file' && ENV_NAME.test(one.name) && !ENV_EXAMPLE.test(one.name))
      .map(one => one.name)
    if (names.length === 0) continue
    const rel = (name: string) => (dir === cwd ? name : `${dir.slice(cwd.length + 1)}/${name}`)
    found.files.push(...names.map(rel))
    const ignored = await $.process
      .run(['git', '-C', dir, 'check-ignore', ...names], { timeoutMs: 5000 })
      .catch(() => null)
    // 128: not a git repository, so nothing there can be committed.
    if (ignored === null || ignored.exitCode === 128) continue
    const ignoredSet = new Set(ignored.stdout.split('\n').map(line => line.trim()))
    const listed = await $.process
      .run(['git', '-C', dir, 'ls-files', '--', ...names], { timeoutMs: 5000 })
      .catch(() => null)
    const trackedSet = new Set((listed?.stdout ?? '').split('\n').map(line => line.trim()))
    for (const name of names) {
      if (trackedSet.has(name)) found.tracked.push(rel(name))
      else if (!ignoredSet.has(name)) found.unignored.push(rel(name))
    }
  }
  await update($, envAtom, () => found)
  await refreshStatus($)
  return found
}

export const envSummary = (s: EnvStatus, lang: Lang) => {
  if (!s.isChecked) return say(lang, 'Taranıyor…', 'Scanning…')
  if (s.files.length === 0) return say(lang, '.env dosyası bulunmadı.', 'No .env files found.')
  const lines = [say(lang, `${s.files.length} .env dosyası bulundu.`, `Found ${s.files.length} .env files.`)]
  if (s.tracked.length) {
    lines.push(say(lang, `❌ Git'e eklenmiş (geçmişte açıkta): ${s.tracked.join(', ')}`, `❌ Tracked by git (exposed in history): ${s.tracked.join(', ')}`))
  }
  if (s.unignored.length) lines.push(say(lang, `⚠ .gitignore'da değil: ${s.unignored.join(', ')}`, `⚠ Not in .gitignore: ${s.unignored.join(', ')}`))
  if (!s.tracked.length && !s.unignored.length) lines.push(say(lang, '✓ Hepsi git dışında.', '✓ All kept out of git.'))
  return lines.join('\n')
}

// What a `git add`, `git commit` or `git push` in `command` would put in
// history or publish that should not be there: sensitive files and keys in
// the added lines. Null: nothing.
export async function commitProblems($: EngineInterface, command: string, cwd: string) {
  const lang = await langOf($)
  const sensitive = say(lang, 'hassas dosya', 'sensitive file')
  const problems: string[] = []
  for (const op of gitOps(command)) {
    const dir = resolveDir(cwd, op.dir)
    const git = (args: string[]) => $.process.run(['git', '-C', dir, ...args], { timeoutMs: 15000 }).catch(() => null)
    if (op.sub === 'add') {
      const args = op.args.filter(arg => !['-p', '--patch', '-i', '--interactive', '-e', '--edit'].includes(arg))
      const dry = await git(['add', '--dry-run', ...args])
      if (dry === null || dry.exitCode !== 0) continue
      const files = dry.stdout
        .split('\n')
        .map(line => /^add '(.+)'$/.exec(line)?.[1])
        .filter((one): one is string => one !== undefined)
      for (const file of files) if (isSensitivePath(file)) problems.push(`${sensitive}: ${file}`)
      for (const file of files.slice(0, 40)) {
        const text = await $.fs.read(`${dir}/${file}`).catch(() => null)
        if (typeof text !== 'string') continue
        const kinds = findSecrets(text, true)
        if (kinds.length) problems.push(`${file}: ${kinds.join(', ')}`)
      }
    } else if (op.sub === 'commit') {
      const isAll = isCommitAll(op.args)
      const names = [
        ...((await git(['diff', '--cached', '--name-only']))?.stdout.split('\n') ?? []),
        ...(isAll ? ((await git(['diff', '--name-only']))?.stdout.split('\n') ?? []) : []),
      ].filter(Boolean)
      for (const name of names) if (isSensitivePath(name)) problems.push(`${sensitive}: ${name}`)
      const diff =
        ((await git(['diff', '--cached', '-U0']))?.stdout ?? '') + (isAll ? ((await git(['diff', '-U0']))?.stdout ?? '') : '')
      const kinds = findSecrets(addedLines(diff), true)
      if (kinds.length) problems.push(say(lang, `eklenen satırlarda ${kinds.join(', ')}`, `added lines hold ${kinds.join(', ')}`))
    } else {
      const found = await pushProblems($, dir)
      if (found !== null) problems.push(say(lang, `gönderilecek commit'lerde ${found}`, `commits to push: ${found}`))
    }
  }
  return problems.length ? [...new Set(problems)].join('; ') : null
}

// ---- history and trends ----------------------------------------------------------

export async function addHistory($: EngineInterface, text: string, project: string) {
  const item: HistoryItem = { text: short(text, 2000), project, at: await $.clock.now() }
  const list = await update($, historyAtom, old => [...old.filter(one => one.text !== item.text), item].slice(-100))
  await $.store.set('history', list)
}

const dayOf = (ms: number) => dayKey(ms).slice('cost-day:'.length)

// Adds one reading to a day's running average under `prefix`.
export async function addSample($: EngineInterface, prefix: string, now: number, value: number) {
  const key = `${prefix}:${dayOf(now)}`
  const old = (await $.store.get(key)) as { sum?: unknown; n?: unknown } | undefined
  const sum = typeof old?.sum === 'number' ? old.sum : 0
  const n = typeof old?.n === 'number' ? old.n : 0
  await $.store.set(key, { sum: sum + value, n: n + 1 })
}

async function daily($: EngineInterface, prefix: string, now: number, count: number) {
  const values: number[] = []
  for (let i = count - 1; i >= 0; i -= 1) values.push(average(await $.store.get(`${prefix}:${dayOf(now - i * DAY_MS)}`)))
  return values
}

export async function refreshTrends($: EngineInterface, now: number) {
  const quality = await daily($, 'quality-day', now, 14)
  const score = await daily($, 'score-day', now, 14)
  await update($, trendsAtom, () => ({ quality, score }))
}

// ---- costs per project -------------------------------------------------------------

export async function bookCost($: EngineInterface, now: number, project: string, delta: number) {
  const dayCost = await $.store.get(dayKey(now))
  await $.store.set(dayKey(now), (typeof dayCost === 'number' ? dayCost : 0) + delta)
  const key = `cost-proj:${dayOf(now)}`
  const old = await $.store.get(key)
  const map = typeof old === 'object' && old !== null ? { ...(old as Record<string, number>) } : {}
  map[project] = (map[project] ?? 0) + delta
  await $.store.set(key, map)
}

// Spend per project over the seven days ending `endDaysAgo` days ago.
export async function projectCosts($: EngineInterface, now: number, endDaysAgo = 0): Promise<ProjectCost[]> {
  const sums: Record<string, number> = {}
  for (let i = endDaysAgo; i < endDaysAgo + 7; i += 1) {
    const map = await $.store.get(`cost-proj:${dayOf(now - i * DAY_MS)}`)
    if (typeof map !== 'object' || map === null) continue
    for (const [name, usd] of Object.entries(map as Record<string, unknown>)) {
      if (typeof usd === 'number') sums[name] = (sums[name] ?? 0) + usd
    }
  }
  return Object.entries(sums)
    .map(([name, usd]) => ({ name, usd }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 6)
}

export async function projectToday($: EngineInterface, now: number, project: string) {
  const map = await $.store.get(`cost-proj:${dayOf(now)}`)
  const value = typeof map === 'object' && map !== null ? (map as Record<string, unknown>)[project] : undefined
  return typeof value === 'number' ? value : 0
}

const weekTitle = (from: number, to: number) => {
  const day = (ms: number) => {
    const d = new Date(ms)
    return `${d.getDate()}.${d.getMonth() + 1}`
  }
  return `${day(from)} – ${day(to)}`
}

// The seven days ending `endDaysAgo` days before `now`.
export async function buildReport($: EngineInterface, now: number, endDaysAgo: number): Promise<WeeklyReport> {
  const days: number[] = []
  let turns = 0
  const scores: number[] = []
  const qualities: number[] = []
  for (let i = endDaysAgo + 6; i >= endDaysAgo; i -= 1) {
    const at = now - i * DAY_MS
    const dayCost = await $.store.get(dayKey(at))
    days.push(typeof dayCost === 'number' ? dayCost : 0)
    const score = (await $.store.get(`score-day:${dayOf(at)}`)) as { n?: unknown } | undefined
    if (average(score) > 0) {
      scores.push(average(score))
      turns += typeof score?.n === 'number' ? score.n : 0
    }
    const quality = await $.store.get(`quality-day:${dayOf(at)}`)
    if (average(quality) > 0) qualities.push(average(quality))
  }
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null)
  return {
    title: weekTitle(now - (endDaysAgo + 6) * DAY_MS, now - endDaysAgo * DAY_MS),
    totalUsd: days.reduce((a, b) => a + b, 0),
    days,
    projects: await projectCosts($, now, endDaysAgo),
    avgScore: mean(scores),
    avgQuality: mean(qualities),
    turns,
  }
}

// ---- packages -------------------------------------------------------------------

async function fetchJson($: EngineInterface, url: string) {
  const response = await $.http.fetch(url, { headers: { accept: 'application/json' } }).catch(() => null)
  if (response === null) return { status: 0, json: null }
  return { status: response.status, json: response.ok ? parseJson(response.text) : null }
}

export async function checkPackage(
  $: EngineInterface,
  ecosystem: 'npm' | 'pypi',
  name: string,
  version: string | null,
): Promise<PackageCheck> {
  const lang = await langOf($)
  const now = await $.clock.now()
  let created: number | null = null
  let weekly: number | null = null
  let latest: string | null = null
  if (ecosystem === 'npm') {
    const meta = await fetchJson($, `https://registry.npmjs.org/${name.replace('/', '%2F')}`)
    if (meta.status === 404) {
      return { name, ecosystem, verdict: 'block', note: say(lang, "npm'de böyle bir paket yok (uydurulmuş olabilir)", 'no such package on npm (it may be made up)') }
    }
    const time = meta.json?.time as Record<string, unknown> | undefined
    if (typeof time?.created === 'string') created = Date.parse(time.created)
    const tags = meta.json?.['dist-tags'] as { latest?: unknown } | undefined
    if (typeof tags?.latest === 'string') latest = tags.latest
    const stats = await fetchJson($, `https://api.npmjs.org/downloads/point/last-week/${name}`)
    if (typeof stats.json?.downloads === 'number') weekly = stats.json.downloads
  } else {
    const meta = await fetchJson($, `https://pypi.org/pypi/${name}/json`)
    if (meta.status === 404) {
      return { name, ecosystem, verdict: 'block', note: say(lang, "PyPI'da böyle bir paket yok (uydurulmuş olabilir)", 'no such package on PyPI (it may be made up)') }
    }
    const releases = meta.json?.releases as Record<string, { upload_time_iso_8601?: string }[]> | undefined
    for (const files of Object.values(releases ?? {})) {
      for (const file of files) {
        const at = file.upload_time_iso_8601 ? Date.parse(file.upload_time_iso_8601) : NaN
        if (!Number.isNaN(at) && (created === null || at < created)) created = at
      }
    }
    const info = meta.json?.info as { version?: unknown } | undefined
    if (typeof info?.version === 'string') latest = info.version
    const stats = await fetchJson($, `https://pypistats.org/api/packages/${name.toLowerCase()}/recent`)
    const data = stats.json?.data as { last_week?: unknown } | undefined
    if (typeof data?.last_week === 'number') weekly = data.last_week
  }
  const ageDays = created === null ? null : Math.floor((now - created) / DAY_MS)
  const lookalike = lookalikeOf(ecosystem, name)
  const facts = [
    ageDays === null ? null : say(lang, `${ageDays} günlük`, `${ageDays} days old`),
    weekly === null ? null : say(lang, `haftada ${weekly.toLocaleString('tr-TR')} indirme`, `${weekly.toLocaleString('en-US')} downloads a week`),
  ]
    .filter(Boolean)
    .join(', ')
  if (lookalike && ((weekly ?? 0) < 10000 || (ageDays ?? 0) < 90)) {
    return {
      name,
      ecosystem,
      verdict: 'block',
      note: say(lang, `"${lookalike}" paketine çok benziyor (${facts || 'bilgi yok'}), taklit olabilir`, `looks like "${lookalike}" (${facts || 'no data'}); it may be a typosquat`),
    }
  }
  const checked = version ?? latest
  const vulns = checked === null ? null : await osvQuery($, ecosystem, name, checked)
  const vulnNote =
    vulns && vulns.ids.length
      ? say(
          lang,
          ` · ⚠ ${checked} sürümünde ${vulns.ids.length} güvenlik açığı (${vulns.ids.slice(0, 2).join(', ')})${vulns.fixed ? `, düzeltilmiş: ${vulns.fixed}` : ''}`,
          ` · ⚠ ${vulns.ids.length} known vulnerabilities in ${checked} (${vulns.ids.slice(0, 2).join(', ')})${vulns.fixed ? `, fixed in ${vulns.fixed}` : ''}`,
        )
      : ''
  if ((ageDays !== null && ageDays < 14) || (weekly !== null && weekly < 500)) {
    return { name, ecosystem, verdict: 'warn', note: say(lang, `yeni ya da az kullanılıyor: ${facts}`, `new or little used: ${facts}`) + vulnNote }
  }
  if (vulnNote) return { name, ecosystem, verdict: 'warn', note: (facts || '') + vulnNote }
  return { name, ecosystem, verdict: 'ok', note: facts || say(lang, 'kontrol edilemedi', 'could not check') }
}

// Checks every package `command` installs; answers why to stop it, or null.
export async function checkInstalls($: EngineInterface, command: string) {
  const lang = await langOf($)
  const blocks: string[] = []
  for (const install of parseInstalls(command)) {
    for (const pkg of install.packages.slice(0, 8)) {
      const check = await checkPackage($, install.ecosystem, pkg.name, pkg.version)
      await update($, packagesAtom, old => [...old.filter(one => one.name !== pkg.name), check].slice(-8))
      if (check.verdict === 'block') blocks.push(`${pkg.name}: ${check.note}`)
      else if (check.verdict === 'warn') $.ui.toast(`📦 ${pkg.name}: ${check.note}`)
    }
  }
  if (blocks.length) await logEvent($, say(lang, `Paket durduruldu: ${short(blocks.join('; '), 60)}`, `Package stopped: ${short(blocks.join('; '), 60)}`))
  return blocks.length ? blocks.join('; ') : null
}

// ---- network --------------------------------------------------------------------

export async function noteUrls($: EngineInterface, urls: string[]) {
  const lang = await langOf($)
  for (const url of urls) {
    const domain = domainOf(url)
    if (domain === null) continue
    const isKnown = isKnownDomain(domain)
    const rows = await read($, networkAtom)
    const old = rows.find(one => one.domain === domain)
    if (old === undefined && !isKnown) {
      $.ui.toast(say(lang, `🌐 Yeni alan adına erişim: ${domain}`, `🌐 New domain reached: ${domain}`))
      await logEvent($, say(lang, `Ağ: ${domain}`, `Network: ${domain}`))
    }
    const row: NetRow = { domain, count: (old?.count ?? 0) + 1, isKnown }
    await update($, networkAtom, list => [...list.filter(one => one.domain !== domain), row].slice(-15))
  }
}

// ---- changed files ----------------------------------------------------------------

// What each file held before this session's first edit of it; null: it did
// not exist. Lost with a reload, which leaves git as the diff's base.
const snapshots = new Map<string, string | null>()

export async function takeSnapshot($: EngineInterface, path: string) {
  if (snapshots.has(path)) return
  const text = await $.fs.read(path).catch((error: unknown) => (String(error).includes('ENOENT') ? null : undefined))
  if (text === undefined) return
  snapshots.set(path, typeof text === 'string' ? text : null)
}

export async function markChanged($: EngineInterface, path: string) {
  const snapshot = snapshots.get(path)
  await update($, changedFilesAtom, list => {
    const old = list.find(one => one.path === path)
    const row: ChangedFile = {
      path,
      edits: (old?.edits ?? 0) + 1,
      isNew: old?.isNew ?? snapshot === null,
      hasSnapshot: snapshots.has(path),
    }
    return [...list.filter(one => one.path !== path), row].slice(-30)
  })
}

export async function showDiff($: EngineInterface, path: string) {
  const lang = await langOf($)
  const open = await read($, diffViewAtom)
  if (open?.path === path) {
    await update($, diffViewAtom, () => null)
    return
  }
  const snapshot = snapshots.get(path)
  const dir = path.slice(0, path.lastIndexOf('/')) || '/'
  const before = say(lang, 'önce', 'before')
  const now = say(lang, 'şimdi', 'now')
  const run =
    snapshot === undefined
      ? await $.process.run(['git', '-C', dir, 'diff', '--', path], { timeoutMs: 10000 }).catch(() => null)
      : snapshot === null
        ? await $.process.run(['diff', '-u', '--label', '/dev/null', '--label', now, '/dev/null', path], { timeoutMs: 10000 }).catch(() => null)
        : await $.process
            .run(['diff', '-u', '--label', before, '--label', now, '-', path], { stdin: snapshot, timeoutMs: 10000 })
            .catch(() => null)
  const text =
    run === null
      ? say(lang, 'Diff alınamadı.', 'Could not get a diff.')
      : run.stdout.trim() || say(lang, 'Fark yok (dosya eski haline dönmüş).', 'No difference (the file is back as it was).')
  await update($, diffViewAtom, () => ({ path, text: maskSecrets(text, true) }))
}

export async function revertFile($: EngineInterface, path: string) {
  const lang = await langOf($)
  const snapshot = snapshots.get(path)
  await update($, confirmRevertAtom, () => null)
  if (snapshot === undefined) {
    $.ui.toast(say(lang, 'Bu dosyanın oturum başındaki hali bilinmiyor (mod yeniden yüklendi).', "This file's state before the session is unknown (the mod reloaded)."))
    return
  }
  if (snapshot === null) {
    const removed = await $.process.run(['rm', '--', path], { timeoutMs: 5000 }).catch(() => null)
    if (removed?.exitCode !== 0) {
      $.ui.toast(say(lang, 'Dosya silinemedi.', 'Could not delete the file.'))
      return
    }
  } else {
    await $.fs.write(path, snapshot)
  }
  await update($, changedFilesAtom, list => list.filter(one => one.path !== path))
  await update($, diffViewAtom, open => (open?.path === path ? null : open))
  await $.session
    .append({
      message: {
        type: 'user',
        content: [
          {
            type: 'text',
            text: `[asistan] The user reverted ${path} to its state before this session's first edit of it${snapshot === null ? ' (the file was deleted)' : ''}. Your earlier changes to this file are gone.`,
          },
        ],
      },
    })
    .catch(() => undefined)
  const file = path.split('/').pop() ?? path
  $.ui.toast(snapshot === null ? say(lang, `${file} silindi.`, `${file} deleted.`) : say(lang, `${file} geri alındı.`, `${file} reverted.`))
}

// ---- tests ------------------------------------------------------------------------

async function exists($: EngineInterface, path: string) {
  return (await $.fs.stat(path).catch(() => null)) !== null
}

// The project's test command: one set with /test-komutu, else what its
// files say (package.json's test script, pytest, cargo, go).
export async function detectTestCommand($: EngineInterface, cwd: string): Promise<string[] | null> {
  const custom = await $.store.get(`test-cmd:${cwd}`)
  if (typeof custom === 'string' && custom.trim()) return ['bash', '-lc', custom]
  const pkg = await $.fs.read(`${cwd}/package.json`).catch(() => null)
  if (typeof pkg === 'string') {
    const scripts = (parseJson(pkg)?.scripts ?? {}) as Record<string, unknown>
    const test = scripts.test
    if (typeof test === 'string' && !test.includes('no test specified')) {
      if ((await exists($, `${cwd}/bun.lockb`)) || (await exists($, `${cwd}/bun.lock`))) return ['bun', 'run', 'test']
      if (await exists($, `${cwd}/pnpm-lock.yaml`)) return ['pnpm', 'test']
      if (await exists($, `${cwd}/yarn.lock`)) return ['yarn', 'test']
      return ['npm', 'test', '--silent']
    }
  }
  const hasPytest =
    (await exists($, `${cwd}/pytest.ini`)) || (await exists($, `${cwd}/conftest.py`)) || (await exists($, `${cwd}/tests`))
  const isPython =
    (await exists($, `${cwd}/pyproject.toml`)) || (await exists($, `${cwd}/pytest.ini`)) || (await exists($, `${cwd}/setup.py`))
  if (hasPytest && isPython) return ['python3', '-m', 'pytest', '-q']
  if (await exists($, `${cwd}/Cargo.toml`)) return ['cargo', 'test', '--quiet']
  if (await exists($, `${cwd}/go.mod`)) return ['go', 'test', './...']
  return null
}

export async function runTests($: EngineInterface) {
  const lang = await langOf($)
  const current = await read($, testsAtom)
  if (current?.state === 'running') return
  const cwd = await $.session.cwd()
  const argv = await detectTestCommand($, cwd)
  const at = await $.clock.now()
  if (argv === null) {
    const summary = say(lang, 'Test komutu bulunamadı: /test-komutu <komut>', 'No test command found: /test-komutu <command>')
    await update($, testsAtom, () => ({ state: 'none', command: '', summary, output: '', at }))
    return
  }
  const command = argv[0] === 'bash' ? (argv[2] ?? '') : argv.join(' ')
  await update($, testsAtom, () => ({ state: 'running', command, summary: say(lang, 'Çalışıyor…', 'Running…'), output: '', at }))
  const run = await $.process.run(argv, { cwd, timeoutMs: 600000 }).catch((error: unknown) => ({
    exitCode: 1,
    stdout: '',
    stderr: String(error),
    isStdoutTruncated: false,
    isStderrTruncated: false,
  }))
  const output = maskSecrets(`${run.stdout}\n${run.stderr}`.trim(), true)
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean)
  const summary = short(lines.findLast(line => /pass|fail|test|ok|error|✓|✗/i.test(line)) ?? lines[lines.length - 1] ?? '', 100)
  const isPass = run.exitCode === 0
  await update($, testsAtom, () => ({ state: isPass ? 'pass' : 'fail', command, summary, output: output.slice(-6000), at }))
  if (!isPass) $.ui.toast(say(lang, `🧪 Testler başarısız: ${short(summary, 60)}`, `🧪 Tests failed: ${short(summary, 60)}`))
}

export async function sendTestsToClaude($: EngineInterface) {
  const lang = await langOf($)
  const tests = await read($, testsAtom)
  if (tests === null || tests.state !== 'fail') return
  const tail = `\n\`\`\`\n${tests.output.slice(-3000)}\n\`\`\`\n`
  await $.prompt.fill({
    text: say(
      lang,
      `Testler başarısız oldu (\`${tests.command}\`). Çıktının sonu:${tail}Hatanın nedenini bul ve düzelt.`,
      `The tests failed (\`${tests.command}\`). The end of the output:${tail}Find the cause and fix it.`,
    ),
    mode: 'replace',
  })
  $.ui.toast(say(lang, 'Test çıktısı kutuya yazıldı, göndermek için Enter.', 'The test output is in the box; Enter sends it.'))
}

// ---- tasks ------------------------------------------------------------------------

export async function applyTaskCall($: EngineInterface, tool: string, input: Record<string, unknown>, reply: string) {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const rows: TaskRow[] = input.todos
      .filter(
        (one): one is { content: string; status: TaskRow['status'] } =>
          typeof one === 'object' && one !== null && typeof one.content === 'string',
      )
      .map((one, i) => ({ id: String(i + 1), title: one.content, status: one.status ?? 'pending' }))
    await update($, tasksAtom, () => rows)
    return
  }
  if (tool === 'TaskCreate' && typeof input.subject === 'string') {
    const list = await read($, tasksAtom)
    const id = /#?(\d+)/.exec(reply)?.[1] ?? String(list.length + 1)
    const row: TaskRow = { id, title: input.subject, status: 'pending' }
    await update($, tasksAtom, old => [...old.filter(one => one.id !== id), row].slice(-30))
    return
  }
  if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
    const id = input.taskId
    const status = input.status
    await update($, tasksAtom, old =>
      status === 'deleted'
        ? old.filter(one => one.id !== id)
        : old.map(one =>
            one.id === id
              ? {
                  ...one,
                  title: typeof input.subject === 'string' ? input.subject : one.title,
                  status: status === 'pending' || status === 'in_progress' || status === 'completed' ? status : one.status,
                }
              : one,
          ),
    )
  }
}

// ---- answers ----------------------------------------------------------------------

export async function copyBlock(
  $: EngineInterface,
  block: CodeBlock,
  surface: Parameters<EngineInterface['ui']['copy']>[0]['surface'],
) {
  const lang = await langOf($)
  const copied = await $.ui.copy({ text: block.text, surface })
  $.ui.toast(copied.isCopied ? say(lang, '📋 Kopyalandı.', '📋 Copied.') : say(lang, `Kopyalanamadı: ${copied.reason}`, `Could not copy: ${copied.reason}`))
}

export async function speak($: EngineInterface, text: string) {
  await $.audio.speak(text).catch(() => undefined)
}
