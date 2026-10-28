import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { AsistanSettings, Lang, Metrics, SecretMode } from '../types'
import {
  addHistory,
  addSample,
  addTip,
  applyTaskCall,
  bookCost,
  buildReport,
  changeSettings,
  checkInstalls,
  commitProblems,
  digestTurn,
  dropTip,
  envSummary,
  fillTemplate,
  improve,
  improveDraft,
  languageNote,
  loadSettings,
  logEvent,
  markChanged,
  modelHint,
  noteUrls,
  notifyDesktop,
  pollAgents,
  projectCosts,
  projectToday,
  recordImproved,
  refreshStatus,
  refreshTrends,
  runTests,
  saveTemplates,
  scanEnv,
  setBusy,
  speak,
  spendToday,
  takeSnapshot,
  weekDays,
} from './actions'
import {
  exportSettings,
  importSettings,
  loadRules,
  loadTeamTemplates,
  recordTimeline,
  remoteChannels,
  scanDependencies,
  scanGitHistory,
  sendRemote,
  setRemoteOptions,
  shareTemplate,
  updateEstimate,
} from './extra'
import {
  DAY_MS,
  MODE_LABEL,
  NEXT_MODE,
  RISKY,
  SENSITIVE_IN_COMMAND,
  cachePctOf,
  codeBlocksIn,
  dayKey,
  findSecrets,
  gitOps,
  isSensitivePath,
  isVague,
  maskOutput,
  maskSecrets,
  parseInstalls,
  projectOf,
  say,
  scoreOf,
  secretRanges,
  short,
  urlsIn,
  usd,
} from './lib'
import { PANE, PANE_TITLE, renderBand, renderPane } from './pane'
import { DEFAULT_SETTINGS as ATOM_DEFAULT_SETTINGS, EMPTY_METRICS as ATOM_EMPTY_METRICS } from './lib'

// The state this file reads and writes. The scan that lists a mod's state
// takes atoms only from the file that reads them, so each file declares the
// atoms it uses: keep the copies alike (same key, initial value and shape tag
// in every file). Change a shape tag when that value's fields change; it
// declines what an earlier version stored, which outlives a reload.
const settingsAtom = atom({ plugin: 'asistan', key: 'settings' } as const, ATOM_DEFAULT_SETTINGS, { shape: 'settings-3' })
const lastPromptAtom = atom({ plugin: 'asistan', key: 'lastPrompt' } as const, null, { shape: 'prompt-3' })
const metricsAtom = atom({ plugin: 'asistan', key: 'metrics' } as const, ATOM_EMPTY_METRICS, { shape: 'metrics-3' })
const reportAtom = atom({ plugin: 'asistan', key: 'report' } as const, null, { shape: 'report-1' })
const envAtom = atom({ plugin: 'asistan', key: 'env' } as const, { isChecked: false, files: [], tracked: [], unignored: [] }, { shape: 'env-1' })
const lastErrorAtom = atom({ plugin: 'asistan', key: 'lastError' } as const, null, { shape: 'error-1' })
const templatesAtom = atom({ plugin: 'asistan', key: 'templates' } as const, [], { shape: 'templates-1' })
const codeBlocksAtom = atom({ plugin: 'asistan', key: 'codeBlocks' } as const, [], { shape: 'code-1' })
const turnStatsAtom = atom({ plugin: 'asistan', key: 'turnStats' } as const, [], { shape: 'turns-1' })
const vulnScanAtom = atom({ plugin: 'asistan', key: 'vulnScan' } as const, null, { shape: 'vulns-1' })
const teamTemplatesAtom = atom({ plugin: 'asistan', key: 'teamTemplates' } as const, [], { shape: 'team-1' })
const rulesAtom = atom({ plugin: 'asistan', key: 'rules' } as const, null)
const estimateAtom = atom({ plugin: 'asistan', key: 'estimate' } as const, null)
const warningAtom = atom({ plugin: 'asistan', key: 'warning' } as const, null)
const projectBudgetAtom = atom({ plugin: 'asistan', key: 'projectBudget' } as const, null)

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const COMMANDS: { name: string; tr: string; en: string; argumentHint?: string }[] = [
  { name: 'asistan', tr: 'Asistan panelini açar', en: 'Opens the asistan pane' },
  { name: 'iyilestir', tr: 'Metni İngilizce iyileştirip kutuya yazar', en: 'Improves the text in English and puts it in the box', argumentHint: '<prompt>' },
  { name: 'anahtar-koruma', tr: 'Promptta anahtar bulunursa: uyar | maskele | engelle', en: 'When a prompt holds a key: uyar (warn) | maskele (mask) | engelle (block)', argumentHint: '[uyar|maskele|engelle]' },
  { name: 'prompt-modu', tr: 'Prompt iyileştirme: onek (++ ile) | her-zaman', en: 'Prompt improving: onek (with ++) | her-zaman (always)', argumentHint: '[onek|her-zaman]' },
  { name: 'guvenlik', tr: '.env dosyalarını yeniden tarar', en: 'Rescans .env files' },
  { name: 'zafiyet', tr: 'Bağımlılıkları bilinen güvenlik açıklarına karşı tarar (OSV)', en: 'Checks dependencies for known vulnerabilities (OSV)' },
  { name: 'gecmis-tara', tr: 'Git geçmişinde sızmış anahtar ve hassas dosya arar', en: 'Searches git history for leaked keys and sensitive files' },
  { name: 'ozet', tr: 'Oturum özeti: maliyet, skor, hatalar', en: 'Session summary: cost, score, errors' },
  { name: 'rapor', tr: 'Son 7 günün raporu: maliyet, projeler, skor', en: 'Report of the last 7 days: cost, projects, score' },
  { name: 'sablon', tr: 'Şablonlar: liste, <ad>, kaydet <ad> [metin], sil <ad>, paylas <ad>', en: 'Templates: list, <name>, kaydet <name> [text], sil <name>, paylas <name>', argumentHint: '[<ad>|kaydet|sil|paylas]' },
  { name: 'butce', tr: 'Günlük bütçe: <dolar> | kapat | uyar | durdur | proje <dolar>', en: 'Daily budget: <usd> | kapat | uyar | durdur | proje <usd>', argumentHint: '[<dolar>|kapat|uyar|durdur|proje <dolar>]' },
  { name: 'test-komutu', tr: 'Bu projenin test komutu (boş: otomatik bul)', en: "This project's test command (empty: find it)", argumentHint: '[<komut>|sil]' },
  { name: 'bildirim', tr: 'Telegram/Discord bildirimi: durum | test | ac | kapat', en: 'Telegram/Discord notifications: status | test | ac (on) | kapat (off)', argumentHint: '[test|ac|kapat]' },
  { name: 'ayar-aktar', tr: 'Ayarları dosyaya yazar ya da dosyadan okur: disa [yol] | ice [yol]', en: 'Writes settings to a file or reads them back: disa [path] | ice [path]', argumentHint: '[disa|ice] [yol]' },
  { name: 'dil', tr: 'Arayüz dili: tr | en', en: 'Interface language: tr | en', argumentHint: '[tr|en]' },
]

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

async function langOf($: EngineInterface): Promise<Lang> {
  return (await read($, settingsAtom)).language
}

// Work after a turn that the person need not wait for: one call that
// digests the turn, and the model hint.
const afterTurn = async (
  $: EngineInterface,
  answer: string,
  actions: string[],
  userText: string,
  set: AsistanSettings,
  isLong: boolean,
) => {
  const rules = set.rulesCheck ? await read($, rulesAtom) : null
  if ((set.turnSummary || set.glossary || rules) && answer.trim()) {
    const summary = await digestTurn($, answer, actions, { summary: set.turnSummary, terms: set.glossary, rules })
    if (summary && set.speakSummary && isLong) await speak($, summary)
  }
  if (set.modelHints && userText) await modelHint($, userText)
}

export const register: Register = (on, options) => {
  setRemoteOptions(options)
  let lastCost: number | null = null
  let lastUserText = ''
  let turnActions: string[] = []
  let turnStartedAt = 0
  let hadDraftSecret = false
  let budgetWarnedDay = ''
  let hasEditedThisTurn = false
  const failures = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadSettings($)
    const lang = await langOf($)
    lastCost = (await $.session.usage()).cost?.usd ?? null
    for (const one of COMMANDS) {
      await $.command.register({ name: one.name, description: say(lang, one.tr, one.en), argumentHint: one.argumentHint })
    }
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    void refreshStatus($)
    void scanEnv($, e.cwd)
    void loadTeamTemplates($, e.cwd).catch(() => undefined)
    $.clock.every(4000, () => void pollAgents($))

    const hasRules = await loadRules($, e.cwd)
    const isRepo = (await $.process.run(['git', '-C', e.cwd, 'rev-parse', '--git-dir'], { timeoutMs: 5000 }).catch(() => null))?.exitCode === 0
    if (!hasRules && isRepo) {
      await addTip($, {
        id: 'claudemd',
        level: 'info',
        text: say(lang, 'Bu projede CLAUDE.md yok: proje kurallarını yazmak için /init çalıştır.', 'This project has no CLAUDE.md: run /init to write its rules.'),
      })
    }

    // The first session of a new week shows the week before it, once.
    const now = await $.clock.now()
    await refreshTrends($, now)
    const week = new Date(now - ((new Date(now).getDay() + 6) % 7) * DAY_MS).toDateString()
    if ((await $.store.get('report-week')) !== week) {
      await $.store.set('report-week', week)
      const report = await buildReport($, now, 1)
      if (report.totalUsd > 0) await update($, reportAtom, () => report)
    }
    return started
  })

  // ---- commands -------------------------------------------------------------------

  on('command.run', { command: 'asistan' }, async $ => {
    const lang = await langOf($)
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: opened.isPlaced ? say(lang, 'Asistan paneli açıldı.', 'The asistan pane is open.') : say(lang, `Panel açılamadı: ${opened.reason}`, `Could not open the pane: ${opened.reason}`) }
  })

  on('command.run', { command: 'iyilestir' }, async ($, e) => {
    const lang = await langOf($)
    if (!e.args.trim()) return { text: say(lang, 'Kullanım: /iyilestir <prompt>', 'Usage: /iyilestir <prompt>') }
    await improveDraft($, e.args)
    return { text: say(lang, 'İyileştirilmiş prompt kutuya yazıldı.', 'The improved prompt is in the box.') }
  })

  on('command.run', { command: 'anahtar-koruma' }, async ($, e) => {
    const byArg: Record<string, SecretMode> = { uyar: 'warn', maskele: 'mask', engelle: 'block', warn: 'warn', mask: 'mask', block: 'block' }
    const chosen = byArg[e.args.trim().toLowerCase()]
    const value = await changeSettings($, old => ({ ...old, secretMode: chosen ?? NEXT_MODE[old.secretMode] }))
    return { text: say(value.language, `Anahtar koruması: ${MODE_LABEL.tr[value.secretMode]}`, `Key guard: ${MODE_LABEL.en[value.secretMode]}`) }
  })

  on('command.run', { command: 'prompt-modu' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const value = await changeSettings($, old => ({
      ...old,
      improveMode:
        arg === 'her-zaman' || arg === 'always' ? 'always' : arg === 'onek' || arg === 'prefix' ? 'prefix' : old.improveMode === 'prefix' ? 'always' : 'prefix',
    }))
    const lang = value.language
    return {
      text:
        value.improveMode === 'always'
          ? say(lang, 'Prompt iyileştirme: her prompt (12 karakterden kısa olanlar hariç).', 'Prompt improving: every prompt (but those under 12 characters).')
          : say(lang, 'Prompt iyileştirme: yalnızca ++ ile başlayan promptlar.', 'Prompt improving: only prompts that start with ++.'),
    }
  })

  on('command.run', { command: 'guvenlik' }, async $ => {
    const found = await scanEnv($, await $.session.cwd())
    return { text: envSummary(found, await langOf($)) }
  })

  on('command.run', { command: 'zafiyet' }, async $ => {
    const lang = await langOf($)
    await scanDependencies($, await $.session.cwd())
    const scan = await read($, vulnScanAtom)
    if (scan === null) return { text: '' }
    if (scan.checked === 0) return { text: scan.note }
    const lines = scan.rows.length
      ? scan.rows.map(row => `⚠ ${row.name}@${row.version}: ${row.ids.join(', ')}`)
      : [say(lang, `✓ ${scan.checked} paketin hiçbirinde bilinen açık yok.`, `✓ None of ${scan.checked} packages has a known vulnerability.`)]
    return { text: [...lines, scan.note].filter(Boolean).join('\n') }
  })

  on('command.run', { command: 'gecmis-tara' }, async $ => {
    const lang = await langOf($)
    const cwd = await $.session.cwd()
    $.clock.after(0, () => void scanGitHistory($, cwd))
    return { text: say(lang, 'Git geçmişi taranıyor; sonuç panelin Güvenlik sekmesinde.', 'Scanning git history; the result shows in the Security tab.') }
  })

  on('command.run', { command: 'ozet' }, async $ => {
    const m = await read($, metricsAtom)
    const set = await read($, settingsAtom)
    const lang = set.language
    const cache = cachePctOf(m)
    const lines = [
      say(lang, `Skor: ${m.score ?? '—'}/100`, `Score: ${m.score ?? '—'}/100`),
      say(lang, `Tur: ${m.turns} · Araç çağrısı: ${m.tools} (hata ${m.failed}, red ${m.denied})`, `Turns: ${m.turns} · Tool calls: ${m.tools} (failed ${m.failed}, denied ${m.denied})`),
      say(lang, 'Maliyet: oturum ', 'Cost: session ') +
        `${usd(m.costUsd)} · ${say(lang, 'bugün', 'today')} ${usd(m.todayUsd)}${set.budgetUsd !== null ? ` / $${set.budgetUsd}` : ''} · 7 ${say(lang, 'gün', 'days')} ${usd(m.weekUsd)}`,
      `Cache: ${cache === null ? '—' : `%${cache}`} · Context: ${m.ctxPct === null ? '—' : `%${Math.round(m.ctxPct)}`}`,
      envSummary(await read($, envAtom), lang),
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'sablon' }, async ($, e) => {
    const lang = await langOf($)
    const cwd = await $.session.cwd()
    const [verb = '', name = '', ...rest] = e.args.trim().split(/\s+/)
    const list = await read($, templatesAtom)
    const team = await read($, teamTemplatesAtom)
    if (!verb) {
      const lines = [
        ...list.map(one => `▸ ${one.name}: ${short(one.text, 60)}`),
        ...team.map(one => `👥 ${one.name}: ${short(one.text, 60)}`),
      ]
      return { text: lines.length ? lines.join('\n') : say(lang, 'Kayıtlı şablon yok. /sablon kaydet <ad> <metin>', 'No saved templates. /sablon kaydet <name> <text>') }
    }
    if (verb === 'kaydet') {
      if (!name) return { text: say(lang, 'Kullanım: /sablon kaydet <ad> [metin]', 'Usage: /sablon kaydet <name> [text]') }
      const text = rest.join(' ') || (await read($, lastPromptAtom))?.original || ''
      if (!text) return { text: say(lang, 'Metin yok: /sablon kaydet <ad> <metin>', 'No text: /sablon kaydet <name> <text>') }
      await saveTemplates($, old => [...old.filter(one => one.name !== name), { name, text }].slice(-12))
      return { text: say(lang, `Şablon "${name}" kaydedildi.`, `Template "${name}" saved.`) }
    }
    if (verb === 'sil') {
      await saveTemplates($, old => old.filter(one => one.name !== name))
      return { text: say(lang, `Şablon "${name}" silindi.`, `Template "${name}" deleted.`) }
    }
    if (verb === 'paylas') {
      const found = list.find(one => one.name === name)
      if (!found) return { text: say(lang, `"${name}" adlı şablon yok.`, `No template named "${name}".`) }
      await shareTemplate($, cwd, found)
      return { text: say(lang, `"${name}" ekiple paylaşıldı: .asistan/sablonlar.json (commit etmeyi unutma).`, `"${name}" is shared with the team: .asistan/sablonlar.json (remember to commit it).`) }
    }
    const wanted = e.args.trim()
    const found = list.find(one => one.name === wanted) ?? team.find(one => one.name === wanted)
    if (!found) return { text: say(lang, `"${wanted}" adlı şablon yok.`, `No template named "${wanted}".`) }
    await fillTemplate($, found)
    return { text: say(lang, `Şablon "${found.name}" kutuya yazıldı.`, `Template "${found.name}" is in the box.`) }
  })

  on('command.run', { command: 'butce' }, async ($, e) => {
    const lang = await langOf($)
    const project = projectOf(await $.session.cwd())
    const projectArg = /^proje\s*(.*)$/i.exec(e.args.trim())
    if (projectArg) {
      const value = (projectArg[1] ?? '').trim().toLowerCase().replace(',', '.').replace('$', '')
      const amount = Number(value)
      const budget = value === 'kapat' || !value ? null : Number.isFinite(amount) && amount > 0 ? amount : null
      await update($, projectBudgetAtom, () => budget)
      await $.store.set(`proj-budget:${project}`, budget)
      return {
        text:
          budget === null
            ? say(lang, `${project} için proje bütçesi kaldırıldı.`, `Removed the project budget of ${project}.`)
            : say(lang, `${project} için günlük bütçe: $${budget}`, `Daily budget of ${project}: $${budget}`),
      }
    }
    const arg = e.args.trim().toLowerCase().replace(',', '.').replace('$', '')
    const amount = Number(arg)
    const value = await changeSettings($, old =>
      arg === 'kapat' ? { ...old, budgetUsd: null }
      : arg === 'uyar' ? { ...old, budgetMode: 'warn' }
      : arg === 'durdur' ? { ...old, budgetMode: 'block' }
      : arg && Number.isFinite(amount) && amount > 0 ? { ...old, budgetUsd: amount }
      : old,
    )
    const today = await spendToday($, lastCost)
    return {
      text:
        value.budgetUsd === null
          ? say(lang, `Günlük bütçe yok. Bugün: $${today.toFixed(2)}`, `No daily budget. Today: $${today.toFixed(2)}`)
          : say(
              lang,
              `Günlük bütçe: $${value.budgetUsd} (dolunca ${value.budgetMode === 'block' ? 'durdur' : 'uyar'}). Bugün: $${today.toFixed(2)}`,
              `Daily budget: $${value.budgetUsd} (when spent: ${value.budgetMode === 'block' ? 'stop' : 'warn'}). Today: $${today.toFixed(2)}`,
            ),
    }
  })

  on('command.run', { command: 'rapor' }, async $ => {
    const lang = await langOf($)
    const report = await buildReport($, await $.clock.now(), 0)
    await update($, reportAtom, () => report)
    const lines = [
      `📅 ${report.title}: ${say(lang, 'toplam', 'total')} $${report.totalUsd.toFixed(2)} · ${report.turns} ${say(lang, 'tur', 'turns')}`,
      say(lang, 'Ortalama skor: ', 'Average score: ') +
        `${report.avgScore === null ? '—' : Math.round(report.avgScore)} · ${say(lang, 'ortalama prompt kalitesi', 'average prompt quality')}: ${report.avgQuality === null ? '—' : report.avgQuality.toFixed(1)}`,
      ...report.projects.map(one => `· ${one.name}: $${one.usd.toFixed(2)}`),
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'test-komutu' }, async ($, e) => {
    const lang = await langOf($)
    const cwd = await $.session.cwd()
    const arg = e.args.trim()
    if (arg === 'sil') {
      await $.store.delete(`test-cmd:${cwd}`)
      return { text: say(lang, 'Özel test komutu silindi; komut proje dosyalarından bulunacak.', "The custom test command is gone; it is found from the project's files.") }
    }
    if (!arg) {
      const custom = await $.store.get(`test-cmd:${cwd}`)
      return {
        text:
          typeof custom === 'string'
            ? say(lang, `Test komutu: ${custom}`, `Test command: ${custom}`)
            : say(lang, 'Özel test komutu yok; proje dosyalarından bulunuyor.', "No custom test command; it is found from the project's files."),
      }
    }
    await $.store.set(`test-cmd:${cwd}`, arg)
    return { text: say(lang, `Bu projenin test komutu: ${arg}`, `This project's test command: ${arg}`) }
  })

  on('command.run', { command: 'bildirim' }, async ($, e) => {
    const lang = await langOf($)
    const arg = e.args.trim().toLowerCase()
    const channels = await remoteChannels($)
    const setup = say(
      lang,
      'Kurulum: eklenti ayarlarında telegramBotToken + telegramChatId ya da discordWebhookUrl alanlarını doldur, veya ASISTAN_TELEGRAM_TOKEN, ASISTAN_TELEGRAM_CHAT_ID, ASISTAN_DISCORD_WEBHOOK ortam değişkenlerini tanımla.',
      'Setup: fill telegramBotToken + telegramChatId or discordWebhookUrl in the plugin settings, or set the ASISTAN_TELEGRAM_TOKEN, ASISTAN_TELEGRAM_CHAT_ID, ASISTAN_DISCORD_WEBHOOK environment variables.',
    )
    if (arg === 'ac' || arg === 'kapat') {
      const value = await changeSettings($, old => ({ ...old, remoteNotify: arg === 'ac' }))
      return {
        text: value.remoteNotify
          ? say(lang, `Uzaktan bildirim açık (${channels.join(', ') || 'kanal yok'}).`, `Remote notifications on (${channels.join(', ') || 'no channel'}).`) + (channels.length ? '' : `\n${setup}`)
          : say(lang, 'Uzaktan bildirim kapalı.', 'Remote notifications off.'),
      }
    }
    if (arg === 'test') {
      const sent = await sendRemote($, say(lang, '✅ asistan: test bildirimi', '✅ asistan: test notification'))
      return { text: sent.length ? say(lang, `Gönderildi: ${sent.join(', ')}`, `Sent: ${sent.join(', ')}`) : say(lang, `Gönderilemedi. ${setup}`, `Nothing was sent. ${setup}`) }
    }
    const set = await read($, settingsAtom)
    return {
      text: `${say(lang, 'Kanallar', 'Channels')}: ${channels.join(', ') || '—'} · ${set.remoteNotify ? say(lang, 'açık', 'on') : say(lang, 'kapalı', 'off')}${channels.length ? '' : `\n${setup}`}`,
    }
  })

  on('command.run', { command: 'ayar-aktar' }, async ($, e) => {
    const lang = await langOf($)
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const path = rest.join(' ')
    if (verb === 'disa') {
      const file = await exportSettings($, path)
      return { text: say(lang, `Ayarlar, şablonlar ve sözlük yazıldı: ${file}`, `Settings, templates and glossary written to ${file}`) }
    }
    if (verb === 'ice') {
      const done = await importSettings($, path).catch((error: unknown) => String(error))
      if (typeof done === 'string') return { text: say(lang, `Okunamadı: ${done}`, `Could not read it: ${done}`) }
      await loadSettings($)
      await refreshStatus($)
      return { text: say(lang, `Okundu: ${done.file} (${done.templates} şablon)`, `Read ${done.file} (${done.templates} templates)`) }
    }
    return { text: say(lang, 'Kullanım: /ayar-aktar disa [yol] | ice [yol]', 'Usage: /ayar-aktar disa [path] | ice [path]') }
  })

  on('command.run', { command: 'dil' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const value = await changeSettings($, old => ({
      ...old,
      language: arg === 'en' || arg === 'tr' ? arg : old.language === 'tr' ? 'en' : 'tr',
    }))
    return { text: say(value.language, 'Arayüz dili: Türkçe', 'Interface language: English') }
  })

  // ---- the prompt -----------------------------------------------------------------

  // Paints a key red in the box while it is typed, before anything is sent,
  // and shows what sending the draft would cost.
  on('prompt.change', async ($, e, next) => {
    const changed = await next(e)
    const ranges = secretRanges(e.text)
    if (ranges.length > 0) {
      await $.prompt.paint({
        text: e.text,
        decorations: ranges.map(([start, end]) => ({ start, end, color: 'error', bold: true, underline: true })),
      })
    }
    const hasSecret = ranges.length > 0
    if (hasSecret !== hadDraftSecret) {
      hadDraftSecret = hasSecret
      const set = await read($, settingsAtom)
      await update($, warningAtom, old =>
        hasSecret
          ? say(set.language, `🔐 Taslakta anahtar var (gönderince: ${MODE_LABEL.tr[set.secretMode]})`, `🔐 The draft holds a key (on send: ${MODE_LABEL.en[set.secretMode]})`)
          : old?.startsWith('🔐 Taslakta') || old?.startsWith('🔐 The draft') ? null : old,
      )
    }
    const m = await read($, metricsAtom)
    await updateEstimate($, e.text, m.costUsd !== null && m.turns > 0 ? m.costUsd / m.turns : null)
    return changed
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const set = await read($, settingsAtom)
    const lang = set.language
    let text = e.text
    await update($, estimateAtom, () => null)

    const kinds = findSecrets(text)
    if (kinds.length > 0) {
      const what = kinds.join(', ')
      await logEvent($, `${say(lang, 'Promptta', 'Prompt held')} ${what} (${MODE_LABEL[lang][set.secretMode]})`)
      if (set.secretMode === 'block') {
        await update($, warningAtom, () => say(lang, `🔐 Promptta ${what} var, gönderilmedi.`, `🔐 The prompt holds ${what}; not sent.`))
        return {
          drop: say(
            lang,
            `🔐 Promptta ${what} tespit edildi, gönderilmedi. Anahtarı çıkar ya da /anahtar-koruma ile modu değiştir.`,
            `🔐 Found ${what} in the prompt; not sent. Take the key out or change the mode with /anahtar-koruma.`,
          ),
        }
      }
      if (set.secretMode === 'mask') {
        text = maskSecrets(text)
        $.ui.toast(say(lang, `🔐 ${what} maskelendi.`, `🔐 ${what} masked.`))
      } else {
        await update($, warningAtom, () => say(lang, `⚠ Promptta ${what} vardı ve modele gitti.`, `⚠ The prompt held ${what} and went to the model.`))
      }
    }

    if (set.budgetUsd !== null) {
      const today = await spendToday($, lastCost)
      if (today >= set.budgetUsd) {
        const note = say(lang, `💰 Günlük bütçe doldu: $${today.toFixed(2)} / $${set.budgetUsd}`, `💰 Daily budget spent: $${today.toFixed(2)} / $${set.budgetUsd}`)
        if (set.budgetMode === 'block') {
          await update($, warningAtom, () => `${note}. ${say(lang, 'Gönderilmedi.', 'Not sent.')}`)
          return { drop: `${note}. ${say(lang, "/butce ile artır, kapat ya da 'uyar' moduna al.", "Raise it with /butce, remove it, or switch to 'uyar'.")}` }
        }
        await update($, warningAtom, () => note)
      }
    }

    const projectBudget = await read($, projectBudgetAtom)
    const cwd = await $.session.cwd()
    if (projectBudget !== null) {
      const spent = await projectToday($, await $.clock.now(), projectOf(cwd))
      if (spent >= projectBudget) {
        const note = say(lang, `📁 ${projectOf(cwd)} proje bütçesi doldu: $${spent.toFixed(2)} / $${projectBudget}`, `📁 Budget of ${projectOf(cwd)} spent: $${spent.toFixed(2)} / $${projectBudget}`)
        if (set.budgetMode === 'block') {
          await update($, warningAtom, () => `${note}. ${say(lang, 'Gönderilmedi.', 'Not sent.')}`)
          return { drop: `${note}. ${say(lang, "/butce proje <dolar> ile artır ya da 'uyar' moduna al.", "Raise it with /butce proje <usd> or switch to 'uyar'.")}` }
        }
        await update($, warningAtom, () => note)
      }
    }

    turnActions = []
    turnStartedAt = await $.clock.now()
    hasEditedThisTurn = false
    await addHistory($, text.replace(/^\+\+\s*/, ''), projectOf(cwd))

    // A draft the İyileştir button filled, sent as it was: already English.
    const last = await read($, lastPromptAtom)
    if (last?.isPending && text.trim() === last.en.trim()) {
      await update($, lastPromptAtom, record => record && { ...record, isPending: false })
      lastUserText = last.original
      return next({ ...e, text, context: [...(e.context ?? []), languageNote(last.original)] })
    }

    const hasPrefix = text.startsWith('++')
    if (hasPrefix) text = text.slice(2).trim()
    lastUserText = text
    const isAlways = set.improveMode === 'always' && text.length >= 12

    if (!hasPrefix && isVague(text)) {
      await addTip($, {
        id: 'vague',
        level: 'info',
        text: say(
          lang,
          `"${short(text, 30)}" kısa kaldı: dosya, hedef ve beklenen sonucu yazarsan daha iyi sonuç alırsın (++ ile iyileştirebilirsin).`,
          `"${short(text, 30)}" is short: naming the file, the goal and the expected result gets better results (++ improves it).`,
        ),
      })
    }

    if (!(hasPrefix || isAlways) || !text) return next({ ...e, text })

    await setBusy($, say(lang, '⏳ Prompt iyileştiriliyor…', '⏳ Improving the prompt…'))
    const improved = await improve($, text).catch(() => null)
    await setBusy($, null)
    if (!improved) {
      $.ui.toast(say(lang, 'İyileştirme başarısız, prompt olduğu gibi gönderildi.', 'Improving failed; the prompt went as written.'))
      return next({ ...e, text })
    }
    await recordImproved($, text, improved, false)
    if (improved.quality !== null && improved.quality <= 4) {
      await addTip($, {
        id: 'quality',
        level: 'info',
        text: say(
          lang,
          `Son promptun kalitesi ${improved.quality}/10. Eksik: ${improved.missing.join(', ') || '—'}`,
          `The last prompt rated ${improved.quality}/10. Missing: ${improved.missing.join(', ') || '—'}`,
        ),
      })
    } else {
      await dropTip($, 'quality')
    }
    return next({ ...e, text: improved.en, context: [...(e.context ?? []), languageNote(text)] })
  }).catch(($, e, next) =>
    // The key guard fails closed: a prompt holding a key is not sent unchecked.
    next.called || findSecrets(e.text).length === 0
      ? next(e)
      : { drop: '🔐 Anahtar kontrolü hata verdi; promptta anahtar göründüğü için gönderilmedi. / The key check failed; the prompt seems to hold a key, so it was not sent.' },
  )

  // ---- tools ----------------------------------------------------------------------

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const isMain = input.agentId === undefined
    const set = await read($, settingsAtom)
    const lang = set.language
    const path = [input.file_path, input.path, input.notebook_path].find((one): one is string => typeof one === 'string')
    const command = tool === 'Bash' && typeof input.command === 'string' ? input.command : undefined

    const touchesSensitive =
      (path !== undefined && isSensitivePath(path)) || (command !== undefined && SENSITIVE_IN_COMMAND.test(command))
    if (touchesSensitive) {
      const what = path !== undefined ? short(path.split('/').slice(-2).join('/'), 40) : short(command ?? '', 40)
      if (set.blockEnvRead) {
        await logEvent($, `${say(lang, 'Engellendi', 'Blocked')}: ${tool} ${what}`)
        $.ui.toast(say(lang, '🔐 Hassas dosya erişimi engellendi.', '🔐 Sensitive file access blocked.'))
        return {
          deny: say(
            lang,
            'asistan: hassas dosyalara (.env, anahtarlar, kimlik bilgileri) erişim kullanıcı tarafından kapatıldı. İçeriğe ihtiyacın varsa kullanıcıdan değişken adlarını iste.',
            'asistan: the user turned off access to sensitive files (.env, keys, credentials). If you need what is in them, ask the user for the variable names.',
          ),
        }
      }
      await logEvent($, `${tool}: ${what}`)
    }

    if (command !== undefined) {
      if (set.commitGuard && gitOps(command).length > 0) {
        const problems = await commitProblems($, command, await $.session.cwd())
        if (problems !== null) {
          await logEvent($, `${say(lang, 'Git durduruldu', 'Git stopped')}: ${short(problems, 60)}`)
          $.ui.toast(say(lang, '🔐 Git kontrolü: anahtar ya da hassas dosya bulundu, durduruldu.', '🔐 Git check: found a key or a sensitive file; stopped.'))
          return {
            deny: say(
              lang,
              `asistan git kontrolü: ${problems}. Bunları commit etme ya da gönderme; kullanıcıya sor ya da dosyayı .gitignore'a ekle.`,
              `asistan git check: ${problems}. Do not commit or push these; ask the user or add the file to .gitignore.`,
            ),
          }
        }
      }
      if (set.packageGuard && parseInstalls(command).length > 0) {
        const blocked = await checkInstalls($, command)
        if (blocked !== null) {
          $.ui.toast(say(lang, '📦 Şüpheli paket: kurulum durduruldu.', '📦 Suspicious package: install stopped.'))
          return {
            deny: say(
              lang,
              `asistan paket kontrolü: ${blocked}. Bu paketi kurma; adın doğru olduğundan emin ol ya da kullanıcıya sor.`,
              `asistan package check: ${blocked}. Do not install it; make sure the name is right or ask the user.`,
            ),
          }
        }
      }
      if (set.networkWatch) await noteUrls($, urlsIn(command))
      const risk = RISKY.find(one => one.re.test(command))
      if (risk) {
        $.ui.toast(say(lang, `⚠ Riskli komut: ${risk.label}`, `⚠ Risky command: ${risk.label}`))
        await addTip($, { id: `risk-${risk.label}`, level: 'warn', text: say(lang, `Riskli komut çalıştı: ${short(command, 50)}`, `A risky command ran: ${short(command, 50)}`) })
      }
    }

    if (set.networkWatch && tool === 'WebFetch' && typeof input.url === 'string') await noteUrls($, [input.url])
    const isEdit = EDIT_TOOLS.has(tool) && path !== undefined
    if (isEdit) await takeSnapshot($, path)

    const label = command !== undefined ? short(command.split('\n')[0] ?? '', 60) : path !== undefined ? short(path.split('/').slice(-2).join('/'), 60) : ''
    if (isMain) turnActions.push(`${tool}${label ? `: ${label}` : ''}`)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const endedAt = await $.clock.now()

    const isDenied = ran.deny !== undefined
    const hasFailed = !isDenied && ran.isError === true
    await recordTimeline($, { id: e.tool_use_id, tool, label, ms: endedAt - startedAt, isOk: !isDenied && !hasFailed, at: startedAt })
    await update($, metricsAtom, m => ({
      ...m,
      tools: m.tools + 1,
      failed: m.failed + (hasFailed ? 1 : 0),
      denied: m.denied + (isDenied ? 1 : 0),
    }))
    if (!isDenied && !hasFailed) {
      if (isEdit) {
        await markChanged($, path)
        if (isMain) hasEditedThisTurn = true
      }
      if (TASK_TOOLS.has(tool)) await applyTaskCall($, tool, input, typeof ran.text === 'string' ? ran.text : '')
    }
    if (command !== undefined) {
      const key = command.trim().slice(0, 60)
      const count = hasFailed ? (failures.get(key) ?? 0) + 1 : 0
      failures.set(key, count)
      if (hasFailed) {
        const output = typeof ran.text === 'string' ? ran.text : ''
        await update($, lastErrorAtom, () => ({ command, output: maskOutput(short(output, 8000)).text, explanation: null, at: endedAt }))
      }
      if (count >= 3) {
        await addTip($, {
          id: `fail-${key}`,
          level: 'error',
          text: say(lang, `Aynı komut ${count} kez başarısız: ${short(key, 40)}. Farklı bir yaklaşım iste.`, `The same command failed ${count} times: ${short(key, 40)}. Ask for another approach.`),
        })
      }
    }
    return ran
  })

  // Masks keys in what a tool hands back before the model reads it.
  on('session.append', async ($, e, next) => {
    if (e.door !== 'tool-result') return next(e)
    const set = await read($, settingsAtom)
    if (!set.maskToolOutput) return next(e)
    const kinds = new Set<string>()
    const maskText = (text: string) => {
      const out = maskOutput(text)
      for (const kind of out.kinds) kinds.add(kind)
      return out.text
    }
    const content = e.message.content.map(block => {
      if (block.type !== 'tool_result') return block
      const inner = block.content
      if (typeof inner === 'string') return { ...block, content: maskText(inner) }
      if (!Array.isArray(inner)) return block
      return {
        ...block,
        content: inner.map((part: unknown) => {
          if (typeof part !== 'object' || part === null) return part
          const one = part as Record<string, unknown>
          return one.type === 'text' && typeof one.text === 'string' ? { ...one, text: maskText(one.text) } : one
        }),
      }
    })
    if (kinds.size === 0) return next(e)
    const what = [...kinds].join(', ')
    await logEvent($, say(set.language, `Araç çıktısında maskelendi: ${what}`, `Masked in tool output: ${what}`))
    $.ui.toast(say(set.language, `🔐 Araç çıktısında ${what} maskelendi.`, `🔐 Masked ${what} in tool output.`))
    return next({ ...e, message: { ...e.message, content } })
  })

  // ---- after each turn ------------------------------------------------------------

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    const set = await read($, settingsAtom)
    const lang = set.language

    const usage: ModelUsage | undefined = e.usage
    const now = await $.clock.now()
    const su = await $.session.usage()
    const cost = su.cost?.usd ?? null
    const project = projectOf(await $.session.cwd())
    const delta = cost !== null && lastCost !== null && cost > lastCost ? cost - lastCost : 0
    if (delta > 0) await bookCost($, now, project, delta)
    if (cost !== null) lastCost = cost
    const days = await weekDays($, now)
    const projects = await projectCosts($, now)
    const projectTodayUsd = await projectToday($, now, project)
    const limits = su.rateLimits.map(one => ({ kind: LIMIT_LABEL[one.kind] ?? one.kind, pct: one.percentUsed }))

    const m = await update($, metricsAtom, old => {
      const merged: Metrics = {
        ...old,
        turns: old.turns + 1,
        inputTokens: old.inputTokens + (usage?.input_tokens ?? 0),
        cacheRead: old.cacheRead + (usage?.cache_read_input_tokens ?? 0),
        cacheWrite: old.cacheWrite + (usage?.cache_creation_input_tokens ?? 0),
        ctxPct: su.context.percent ?? old.ctxPct,
        costUsd: cost,
        todayUsd: days[days.length - 1] ?? null,
        weekUsd: days.reduce((sum, one) => sum + one, 0),
        weekDays: days,
        projectTodayUsd,
        projects,
        limits,
      }
      return { ...merged, score: scoreOf(merged) }
    })

    const tokens =
      (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    await update($, turnStatsAtom, list =>
      [...list, { turn: m.turns, label: short(lastUserText || '—', 50), tokens, usd: delta, ms: e.durationMs || now - turnStartedAt }].slice(-40),
    )

    if (m.score !== null) await addSample($, 'score-day', now, m.score)
    await refreshTrends($, now)
    const blocks = codeBlocksIn(e.answer)
    if (blocks.length) await update($, codeBlocksAtom, () => blocks.slice(-6))
    if (set.autoTests && hasEditedThisTurn) {
      hasEditedThisTurn = false
      $.clock.after(100, () => void runTests($))
    }

    const ctx = m.ctxPct ?? 0
    if (ctx >= 80) {
      await addTip($, {
        id: 'ctx',
        level: ctx >= 90 ? 'error' : 'warn',
        text: say(lang, `Context %${Math.round(ctx)} dolu: Özet'teki 🗜 Compact ya da yeni oturum öneririm.`, `Context is ${Math.round(ctx)}% full: try 🗜 Compact in Summary or a new session.`),
      })
    } else {
      await dropTip($, 'ctx')
    }
    const cache = cachePctOf(m)
    if (cache !== null && cache < 50 && m.inputTokens + m.cacheRead + m.cacheWrite > 20000) {
      await addTip($, {
        id: 'cache',
        level: 'warn',
        text: say(lang, `Cache isabeti %${cache}: model değiştirmek ya da 5 dk'dan uzun ara vermek cache'i sıfırlar.`, `Cache hits ${cache}%: switching models or pausing over 5 minutes resets the cache.`),
      })
    } else {
      await dropTip($, 'cache')
    }
    if (m.tools >= 5 && m.failed / m.tools > 0.3) {
      const pct = Math.round((m.failed / m.tools) * 100)
      await addTip($, {
        id: 'fails',
        level: 'warn',
        text: say(lang, `Araç çağrılarının %${pct}'i hata verdi. Ortamı ya da yaklaşımı gözden geçir.`, `${pct}% of tool calls failed. Check the environment or the approach.`),
      })
    } else {
      await dropTip($, 'fails')
    }

    // A rate-limit window past 80%: one notification per window.
    for (const one of su.rateLimits) {
      if (one.percentUsed < 80) continue
      const key = `limit-notified:${one.kind}`
      const window = one.resetsAt ?? 'unknown'
      if ((await $.store.get(key)) === window) continue
      await $.store.set(key, window)
      await notifyDesktop(
        $,
        say(lang, 'Claude Code limiti', 'Claude Code limit'),
        say(lang, `${LIMIT_LABEL[one.kind] ?? one.kind} limiti %${Math.round(one.percentUsed)} doldu.`, `The ${LIMIT_LABEL[one.kind] ?? one.kind} limit is ${Math.round(one.percentUsed)}% used.`),
        false,
      )
    }

    if (set.budgetUsd !== null && m.todayUsd !== null) {
      const day = dayKey(now)
      if (m.todayUsd >= set.budgetUsd * 0.8 && budgetWarnedDay !== day) {
        budgetWarnedDay = day
        const pct = Math.round((m.todayUsd / set.budgetUsd) * 100)
        $.ui.toast(say(lang, `💰 Günlük bütçenin %${pct}'i kullanıldı.`, `💰 ${pct}% of the daily budget is spent.`))
      }
    }

    const isLong = set.notifyAfterSec !== null && e.durationMs >= set.notifyAfterSec * 1000
    if (isLong) {
      const seconds = Math.round(e.durationMs / 1000)
      const took =
        seconds >= 60
          ? say(lang, `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`, `${Math.floor(seconds / 60)} min ${seconds % 60} s`)
          : say(lang, `${seconds} sn`, `${seconds} s`)
      void notifyDesktop($, say(lang, 'Claude Code: tur bitti', 'Claude Code: turn done'), `${project} · ${took}`, set.sound)
    }

    await refreshStatus($)
    const answer = e.answer
    const actions = turnActions
    const userText = lastUserText
    $.clock.after(50, () => void afterTurn($, answer, actions, userText, set, isLong))
    return done
  })

  // ---- drawing ------------------------------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (e.props.hasSurvey ? next(e) : renderBand($, e)))

  on('ui.render', { component: 'Pane', requestId: 'asistan' }, async ($, e) => renderPane($, e))
}
