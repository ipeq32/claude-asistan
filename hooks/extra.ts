// The features that reach outside the session: a local model, OSV, git
// history, the project's CLAUDE.md and shared templates, settings files,
// Telegram and Discord.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { AsistanSettings, Template, Term, TimelineRow, VulnRow } from '../types'
import {
  DEFAULT_SETTINGS,
  estimateTokens,
  historyReader,
  npmLockPackages,
  parseJson,
  requirementPins,
  say,
  short,
} from './lib'
import type { Pkg } from './lib'
import { DEFAULT_SETTINGS as ATOM_DEFAULT_SETTINGS, EMPTY_METRICS as ATOM_EMPTY_METRICS } from './lib'

// The state this file reads and writes. The scan that lists a mod's state
// takes atoms only from the file that reads them, so each file declares the
// atoms it uses: keep the copies alike (same key, initial value and shape tag
// in every file). Change a shape tag when that value's fields change; it
// declines what an earlier version stored, which outlives a reload.
const settingsAtom = atom({ plugin: 'asistan', key: 'settings' } as const, ATOM_DEFAULT_SETTINGS, { shape: 'settings-3' })
const timelineAtom = atom({ plugin: 'asistan', key: 'timeline' } as const, [], { shape: 'timeline-1' })
const vulnScanAtom = atom({ plugin: 'asistan', key: 'vulnScan' } as const, null, { shape: 'vulns-1' })
const historyScanAtom = atom({ plugin: 'asistan', key: 'historyScan' } as const, null, { shape: 'hscan-1' })
const teamTemplatesAtom = atom({ plugin: 'asistan', key: 'teamTemplates' } as const, [], { shape: 'team-1' })
const rulesAtom = atom({ plugin: 'asistan', key: 'rules' } as const, null)
const estimateAtom = atom({ plugin: 'asistan', key: 'estimate' } as const, null)

const OLLAMA = 'http://localhost:11434'

// ---- model calls --------------------------------------------------------------

// One completion for the mod's own work, on Haiku or, when chosen, a local
// Ollama model. A failed local call answers null rather than falling back,
// so text meant to stay on the machine never leaves it.
export async function complete($: EngineInterface, system: string, prompt: string, maxTokens: number) {
  const set = await read($, settingsAtom)
  if (set.modelProvider === 'ollama') {
    if (!set.ollamaModel) return null
    const response = await $.http
      .fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: set.ollamaModel,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          options: { num_predict: maxTokens },
        }),
      })
      .catch(() => null)
    if (!response?.ok) return null
    const message = parseJson(response.text)?.message as { content?: unknown } | undefined
    return typeof message?.content === 'string' ? message.content.trim() : null
  }
  const reply = await $.model
    .complete({ model: 'haiku', system, prompt, maxTokens, timeoutMs: 30000 })
    .catch(() => null)
  return reply?.isAnswered ? reply.text.trim() : null
}

export async function ollamaModels($: EngineInterface) {
  const response = await $.http.fetch(`${OLLAMA}/api/tags`).catch(() => null)
  if (!response?.ok) return null
  const models = parseJson(response.text)?.models
  return Array.isArray(models)
    ? models.map(one => (one as { name?: unknown }).name).filter((name): name is string => typeof name === 'string')
    : []
}

// ---- vulnerabilities ------------------------------------------------------------

const OSV_ECOSYSTEM = { npm: 'npm', pypi: 'PyPI' } as const

// The known vulnerabilities of one version, and the first version that
// fixes one of them.
export async function osvQuery($: EngineInterface, ecosystem: 'npm' | 'pypi', name: string, version: string) {
  const response = await $.http
    .fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] }, version }),
    })
    .catch(() => null)
  if (!response?.ok) return null
  const vulns = parseJson(response.text)?.vulns
  if (!Array.isArray(vulns)) return { ids: [], fixed: null }
  let fixed: string | null = null
  const ids: string[] = []
  for (const vuln of vulns as { id?: unknown; aliases?: unknown; affected?: unknown }[]) {
    const cve = Array.isArray(vuln.aliases) ? vuln.aliases.find((one): one is string => typeof one === 'string' && one.startsWith('CVE-')) : undefined
    const id = cve ?? (typeof vuln.id === 'string' ? vuln.id : undefined)
    if (id) ids.push(id)
    for (const affected of Array.isArray(vuln.affected) ? vuln.affected : []) {
      for (const range of (affected as { ranges?: { events?: { fixed?: unknown }[] }[] }).ranges ?? []) {
        for (const event of range.events ?? []) if (fixed === null && typeof event.fixed === 'string') fixed = event.fixed
      }
    }
  }
  return { ids, fixed }
}

// Checks every pinned dependency of the project (package-lock.json,
// requirements.txt) against OSV in one batch.
export async function scanDependencies($: EngineInterface, cwd: string) {
  const lang = (await read($, settingsAtom)).language
  await update($, vulnScanAtom, () => ({ state: 'running' as const, checked: 0, rows: [], note: '' }))
  const queries: { pkg: Pkg; ecosystem: 'npm' | 'pypi' }[] = []
  const lock = await $.fs.read(`${cwd}/package-lock.json`).catch(() => null)
  if (typeof lock === 'string') for (const pkg of npmLockPackages(lock)) queries.push({ pkg, ecosystem: 'npm' })
  const reqs = await $.fs.read(`${cwd}/requirements.txt`).catch(() => null)
  if (typeof reqs === 'string') for (const pkg of requirementPins(reqs)) queries.push({ pkg, ecosystem: 'pypi' })
  if (queries.length === 0) {
    const note = say(lang, 'package-lock.json ya da sürümü sabit requirements.txt bulunamadı.', 'No package-lock.json or pinned requirements.txt found.')
    await update($, vulnScanAtom, () => ({ state: 'done' as const, checked: 0, rows: [], note }))
    return
  }
  const rows: VulnRow[] = []
  const batch = queries.slice(0, 1000)
  const response = await $.http
    .fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queries: batch.map(one => ({ package: { name: one.pkg.name, ecosystem: OSV_ECOSYSTEM[one.ecosystem] }, version: one.pkg.version })),
      }),
    })
    .catch(() => null)
  const results = response?.ok ? parseJson(response.text)?.results : null
  if (!Array.isArray(results)) {
    await update($, vulnScanAtom, () => ({ state: 'done' as const, checked: 0, rows: [], note: say(lang, "OSV'ye ulaşılamadı.", 'Could not reach OSV.') }))
    return
  }
  results.forEach((result, i) => {
    const vulns = (result as { vulns?: { id?: unknown }[] } | null)?.vulns ?? []
    const query = batch[i]
    if (vulns.length && query) {
      rows.push({
        name: query.pkg.name,
        version: query.pkg.version ?? '',
        ids: vulns.map(one => one.id).filter((id): id is string => typeof id === 'string').slice(0, 4),
      })
    }
  })
  const note =
    queries.length > batch.length
      ? say(lang, `İlk ${batch.length} paket kontrol edildi.`, `Checked the first ${batch.length} packages.`)
      : ''
  await update($, vulnScanAtom, () => ({ state: 'done' as const, checked: batch.length, rows, note }))
}

// ---- git history -------------------------------------------------------------------

// Reads every commit's added lines for keys and committed sensitive files.
export async function scanGitHistory($: EngineInterface, cwd: string) {
  const lang = (await read($, settingsAtom)).language
  await update($, historyScanAtom, () => ({ state: 'running' as const, commits: 0, hits: [], note: '' }))
  const reader = historyReader()
  let rest = ''
  let failed = ''
  try {
    const stream = $.process.spawn({
      argv: ['git', '-C', cwd, 'log', '-p', '--all', '--no-color', '-U0', '--format=commit %H'],
    })
    for await (const chunk of stream) {
      if (chunk.stream === 'stderr') {
        failed += chunk.text
        continue
      }
      const lines = (rest + chunk.text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) reader.line(line)
    }
    if (rest) reader.line(rest)
  } catch (error) {
    failed = String(error)
  }
  const { hits, commits } = reader.result()
  const note =
    commits === 0 && failed
      ? say(lang, `Taranamadı: ${short(failed.trim(), 80)}`, `Could not scan: ${short(failed.trim(), 80)}`)
      : hits.length >= 50
        ? say(lang, 'İlk 50 bulgu gösteriliyor.', 'Showing the first 50 findings.')
        : ''
  await update($, historyScanAtom, () => ({ state: 'done' as const, commits, hits, note }))
}

// What a `git push` from `dir` would publish that should not be: keys in
// the added lines and sensitive files. Null: nothing.
export async function pushProblems($: EngineInterface, dir: string) {
  const range = await $.process
    .run(['git', '-C', dir, 'log', '-p', '--no-color', '-U0', '--format=commit %H', '@{u}..HEAD'], { timeoutMs: 20000 })
    .catch(() => null)
  const log =
    range !== null && range.exitCode === 0
      ? range
      : await $.process
          .run(['git', '-C', dir, 'log', '-p', '--no-color', '-U0', '--format=commit %H', 'HEAD', '--not', '--remotes'], { timeoutMs: 20000 })
          .catch(() => null)
  if (log === null || log.exitCode !== 0) return null
  const reader = historyReader()
  for (const line of log.stdout.split('\n')) reader.line(line)
  const { hits } = reader.result()
  return hits.length ? hits.map(one => `${one.sha} ${one.file}: ${one.kind}`).slice(0, 6).join('; ') : null
}

// ---- CLAUDE.md ----------------------------------------------------------------------

// Loads the project's CLAUDE.md for the rules check; answers whether the
// project has one.
export async function loadRules($: EngineInterface, cwd: string) {
  for (const path of [`${cwd}/CLAUDE.md`, `${cwd}/.claude/CLAUDE.md`]) {
    const text = await $.fs.read(path).catch(() => null)
    if (typeof text === 'string' && text.trim()) {
      await update($, rulesAtom, () => short(text, 6000))
      return true
    }
  }
  await update($, rulesAtom, () => null)
  return false
}

// ---- team templates ---------------------------------------------------------------

const teamFile = (cwd: string) => `${cwd}/.asistan/sablonlar.json`

const asTemplates = (value: unknown): Template[] =>
  Array.isArray(value)
    ? value.filter(
        (one): one is Template =>
          typeof one === 'object' && one !== null && typeof one.name === 'string' && typeof one.text === 'string',
      )
    : []

export async function loadTeamTemplates($: EngineInterface, cwd: string) {
  const text = await $.fs.read(teamFile(cwd)).catch(() => null)
  const list = typeof text === 'string' ? asTemplates(JSON.parse(text.trim() || '[]')) : []
  await update($, teamTemplatesAtom, () => list)
  return list
}

export async function shareTemplate($: EngineInterface, cwd: string, template: Template) {
  const old = await loadTeamTemplates($, cwd).catch(() => [])
  const list = [...old.filter(one => one.name !== template.name), template]
  await $.process.run(['mkdir', '-p', `${cwd}/.asistan`], { timeoutMs: 5000 })
  await $.fs.write(teamFile(cwd), `${JSON.stringify(list, null, 2)}\n`)
  await update($, teamTemplatesAtom, () => list)
}

// ---- settings files -----------------------------------------------------------------

async function settingsPath($: EngineInterface, path: string) {
  if (path.trim()) return path.trim()
  const home = (await $.env.get('HOME')) ?? (await $.session.cwd())
  return `${home}/asistan-ayarlar.json`
}

export async function exportSettings($: EngineInterface, path: string) {
  const file = await settingsPath($, path)
  const data = {
    asistan: 1,
    settings: await read($, settingsAtom),
    templates: (await $.store.get('templates')) ?? [],
    glossary: (await $.store.get('glossary')) ?? [],
  }
  await $.fs.write(file, `${JSON.stringify(data, null, 2)}\n`)
  return file
}

// Answers the file it read, and what it applied; throws on a file that is
// not an export.
export async function importSettings($: EngineInterface, path: string) {
  const file = await settingsPath($, path)
  const data = parseJson(await $.fs.read(file))
  if (data === null || data.asistan !== 1) throw new Error('not an asistan settings file')
  const stored = typeof data.settings === 'object' && data.settings !== null ? (data.settings as Partial<AsistanSettings>) : {}
  const value: AsistanSettings = { ...DEFAULT_SETTINGS, ...stored }
  await update($, settingsAtom, () => value)
  await $.store.set('settings', value)
  const templates = asTemplates(data.templates)
  if (templates.length) await $.store.set('templates', templates)
  if (Array.isArray(data.glossary)) await $.store.set('glossary', data.glossary as Term[])
  return { file, templates: templates.length }
}

// ---- remote notifications ----------------------------------------------------------

let remoteOptions: PluginOptions = {}

export const setRemoteOptions = (options: PluginOptions) => {
  remoteOptions = options
}

async function remoteConfig($: EngineInterface) {
  const option = (key: string) => {
    const value = remoteOptions[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return {
    telegramToken: option('telegramBotToken') ?? (await $.env.get('ASISTAN_TELEGRAM_TOKEN')),
    telegramChat: option('telegramChatId') ?? (await $.env.get('ASISTAN_TELEGRAM_CHAT_ID')),
    discordWebhook: option('discordWebhookUrl') ?? (await $.env.get('ASISTAN_DISCORD_WEBHOOK')),
  }
}

// Which remote channels are set up, by name.
export async function remoteChannels($: EngineInterface) {
  const config = await remoteConfig($)
  return [
    ...(config.telegramToken && config.telegramChat ? ['Telegram'] : []),
    ...(config.discordWebhook ? ['Discord'] : []),
  ]
}

// Sends `text` to every channel set up; answers the ones that took it.
export async function sendRemote($: EngineInterface, text: string) {
  const config = await remoteConfig($)
  const sent: string[] = []
  if (config.telegramToken && config.telegramChat) {
    const response = await $.http
      .fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: config.telegramChat, text }),
      })
      .catch(() => null)
    if (response?.ok) sent.push('Telegram')
  }
  if (config.discordWebhook && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(config.discordWebhook)) {
    const response = await $.http
      .fetch(config.discordWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      .catch(() => null)
    if (response?.ok) sent.push('Discord')
  }
  return sent
}

// ---- timeline and estimate ------------------------------------------------------------

export async function recordTimeline($: EngineInterface, row: TimelineRow) {
  await update($, timelineAtom, list => [...list, row].slice(-80))
}

// What sending the draft would add, as the band shows it while it is typed.
export async function updateEstimate($: EngineInterface, text: string, costPerTurn: number | null) {
  const set = await read($, settingsAtom)
  const lang = set.language
  const tokens = estimateTokens(text.trim())
  const label =
    !set.costEstimate || tokens === 0
      ? null
      : `≈${Math.ceil(tokens / 10) * 10} token${costPerTurn !== null ? say(lang, ` · tur ~$${costPerTurn.toFixed(2)}`, ` · turn ~$${costPerTurn.toFixed(2)}`) : ''}`
  const old = await read($, estimateAtom)
  if (old !== label) await update($, estimateAtom, () => label)
}
