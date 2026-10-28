import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Metrics, SecretMode, AsistanSettings } from '../types'
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
  turkishNote,
  weekDays,
} from './actions'
import {
  DAY_MS,
  SENSITIVE_IN_COMMAND,
  MODE_LABEL,
  NEXT_MODE,
  RISKY,
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
  scoreOf,
  secretRanges,
  short,
  urlsIn,
  usd,
} from './lib'
import { PANE, PANE_TITLE, renderBand, renderPane } from './pane'
import { DEFAULT_SETTINGS as ATOM_DEFAULT_SETTINGS, EMPTY_METRICS as ATOM_EMPTY_METRICS } from './lib'

// The state this file reads and writes. The scan that lists a mod's state
// takes atoms only from the file that reads them, so register.tsx, actions.ts
// and pane.tsx each declare the atoms they use: keep the copies alike (same
// key, initial value and shape tag in every file). Change a shape tag when that
// value's fields change; it declines what an earlier version stored, which
// outlives a reload.
const settingsAtom = atom({ plugin: 'asistan', key: 'settings' } as const, ATOM_DEFAULT_SETTINGS, { shape: 'settings-2' })
const lastPromptAtom = atom({ plugin: 'asistan', key: 'lastPrompt' } as const, null, { shape: 'prompt-3' })
const metricsAtom = atom({ plugin: 'asistan', key: 'metrics' } as const, ATOM_EMPTY_METRICS, { shape: 'metrics-3' })
const reportAtom = atom({ plugin: 'asistan', key: 'report' } as const, null, { shape: 'report-1' })
const envAtom = atom({ plugin: 'asistan', key: 'env' } as const, { isChecked: false, files: [], tracked: [], unignored: [] }, { shape: 'env-1' })
const lastErrorAtom = atom({ plugin: 'asistan', key: 'lastError' } as const, null, { shape: 'error-1' })
const templatesAtom = atom({ plugin: 'asistan', key: 'templates' } as const, [], { shape: 'templates-1' })
const codeBlocksAtom = atom({ plugin: 'asistan', key: 'codeBlocks' } as const, [], { shape: 'code-1' })
const warningAtom = atom({ plugin: 'asistan', key: 'warning' } as const, null)
const projectBudgetAtom = atom({ plugin: 'asistan', key: 'projectBudget' } as const, null)

const LIMIT_LABEL: Record<string, string> = { five_hour: '5s', seven_day: '7g' }

const COMMANDS = [
  { name: 'asistan', description: 'Asistan panelini açar' },
  { name: 'iyilestir', description: 'Metni İngilizce iyileştirip kutuya yazar', argumentHint: '<prompt>' },
  {
    name: 'anahtar-koruma',
    description: 'Promptta anahtar bulunursa: uyar | maskele | engelle',
    argumentHint: '[uyar|maskele|engelle]',
  },
  { name: 'prompt-modu', description: 'Prompt iyileştirme: onek (++ ile) | her-zaman', argumentHint: '[onek|her-zaman]' },
  { name: 'guvenlik', description: '.env dosyalarını yeniden tarar' },
  { name: 'ozet', description: 'Oturum özeti: maliyet, skor, hatalar' },
  {
    name: 'sablon',
    description: 'Prompt şablonları: liste, <ad>, kaydet <ad> [metin], sil <ad>',
    argumentHint: '[<ad>|kaydet <ad> [metin]|sil <ad>]',
  },
  {
    name: 'butce',
    description: 'Günlük bütçe: <dolar> | kapat | uyar | durdur | proje <dolar> | proje kapat',
    argumentHint: '[<dolar>|kapat|uyar|durdur|proje <dolar>]',
  },
  { name: 'rapor', description: 'Son 7 günün raporu: maliyet, projeler, skor' },
  { name: 'test-komutu', description: 'Bu projenin test komutu (boş: otomatik bul)', argumentHint: '[<komut>|sil]' },
]

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

// Work after a turn that the person need not wait for: the Turkish summary
// and the model hint, each one small model call.
const afterTurn = async (
  $: EngineInterface,
  answer: string,
  tools: string[],
  userText: string,
  set: AsistanSettings,
  isLong: boolean,
) => {
  if ((set.turnSummary || set.glossary) && answer.trim()) {
    const summary = await digestTurn($, answer, tools, set.turnSummary, set.glossary)
    if (summary && set.speakSummary && isLong) await speak($, summary)
  }
  if (set.modelHints && userText) await modelHint($, userText)
}

export const register: Register = on => {
  let lastCost: number | null = null
  let lastUserText = ''
  let turnTools: string[] = []
  let hadDraftSecret = false
  let budgetWarnedDay = ''
  let hasEditedThisTurn = false
  const failures = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadSettings($)
    lastCost = (await $.session.usage()).cost?.usd ?? null
    for (const command of COMMANDS) await $.command.register(command)
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    void refreshStatus($)
    void scanEnv($, e.cwd)
    $.clock.every(4000, () => void pollAgents($))
    // The first session of a new week shows the week before it, once.
    const now = await $.clock.now()
    await refreshTrends($, now)
    const week = `${new Date(now - ((new Date(now).getDay() + 6) % 7) * DAY_MS).toDateString()}`
    if ((await $.store.get('report-week')) !== week) {
      await $.store.set('report-week', week)
      const report = await buildReport($, now, 1)
      if (report.totalUsd > 0) await update($, reportAtom, () => report)
    }
    return started
  })

  // ---- commands -------------------------------------------------------------------

  on('command.run', { command: 'asistan' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: opened.isPlaced ? 'Asistan paneli açıldı.' : `Panel açılamadı: ${opened.reason}` }
  })

  on('command.run', { command: 'iyilestir' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Kullanım: /iyilestir <prompt>' }
    await improveDraft($, e.args)
    return { text: 'İyileştirilmiş prompt kutuya yazıldı.' }
  })

  on('command.run', { command: 'anahtar-koruma' }, async ($, e) => {
    const byArg: Record<string, SecretMode> = { uyar: 'warn', maskele: 'mask', engelle: 'block' }
    const chosen = byArg[e.args.trim().toLowerCase()]
    const value = await changeSettings($, old => ({ ...old, secretMode: chosen ?? NEXT_MODE[old.secretMode] }))
    return { text: `Anahtar koruması: ${MODE_LABEL[value.secretMode]}` }
  })

  on('command.run', { command: 'prompt-modu' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const value = await changeSettings($, old => ({
      ...old,
      improveMode:
        arg === 'her-zaman' ? 'always' : arg === 'onek' ? 'prefix' : old.improveMode === 'prefix' ? 'always' : 'prefix',
    }))
    return {
      text:
        value.improveMode === 'always'
          ? 'Prompt iyileştirme: her prompt (12 karakterden kısa olanlar hariç).'
          : 'Prompt iyileştirme: yalnızca ++ ile başlayan promptlar.',
    }
  })

  on('command.run', { command: 'guvenlik' }, async $ => {
    const found = await scanEnv($, await $.session.cwd())
    return { text: envSummary(found) }
  })

  on('command.run', { command: 'ozet' }, async $ => {
    const m = await read($, metricsAtom)
    const set = await read($, settingsAtom)
    const cache = cachePctOf(m)
    const lines = [
      `Skor: ${m.score ?? '—'}/100`,
      `Tur: ${m.turns} · Araç çağrısı: ${m.tools} (hata ${m.failed}, red ${m.denied})`,
      `Maliyet: oturum ${usd(m.costUsd)} · bugün ${usd(m.todayUsd)}${set.budgetUsd !== null ? ` / $${set.budgetUsd}` : ''} · 7 gün ${usd(m.weekUsd)}`,
      `Cache: ${cache === null ? '—' : `%${cache}`} · Context: ${m.ctxPct === null ? '—' : `%${Math.round(m.ctxPct)}`}`,
      envSummary(await read($, envAtom)),
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'sablon' }, async ($, e) => {
    const [verb = '', name = '', ...rest] = e.args.trim().split(/\s+/)
    const list = await read($, templatesAtom)
    if (!verb) {
      return {
        text: list.length
          ? list.map(one => `▸ ${one.name}: ${short(one.text, 60)}`).join('\n')
          : 'Kayıtlı şablon yok. /sablon kaydet <ad> <metin>',
      }
    }
    if (verb === 'kaydet') {
      if (!name) return { text: 'Kullanım: /sablon kaydet <ad> [metin]' }
      const text = rest.join(' ') || (await read($, lastPromptAtom))?.original || ''
      if (!text) return { text: 'Metin yok: /sablon kaydet <ad> <metin>' }
      await saveTemplates($, old => [...old.filter(one => one.name !== name), { name, text }].slice(-12))
      return { text: `Şablon "${name}" kaydedildi.` }
    }
    if (verb === 'sil') {
      await saveTemplates($, old => old.filter(one => one.name !== name))
      return { text: `Şablon "${name}" silindi.` }
    }
    const wanted = e.args.trim()
    const found = list.find(one => one.name === wanted)
    if (!found) return { text: `"${wanted}" adlı şablon yok.` }
    await fillTemplate($, found)
    return { text: `Şablon "${found.name}" kutuya yazıldı.` }
  })

  on('command.run', { command: 'butce' }, async ($, e) => {
    const project = projectOf(await $.session.cwd())
    const projectArg = /^proje\s*(.*)$/i.exec(e.args.trim())
    if (projectArg) {
      const value = (projectArg[1] ?? '').trim().toLowerCase().replace(',', '.').replace('$', '')
      const amount = Number(value)
      const budget = value === 'kapat' || !value ? null : Number.isFinite(amount) && amount > 0 ? amount : null
      await update($, projectBudgetAtom, () => budget)
      await $.store.set(`proj-budget:${project}`, budget)
      return { text: budget === null ? `${project} için proje bütçesi kaldırıldı.` : `${project} için günlük bütçe: $${budget}` }
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
          ? `Günlük bütçe yok. Bugün: $${today.toFixed(2)}`
          : `Günlük bütçe: $${value.budgetUsd} (dolunca ${value.budgetMode === 'block' ? 'durdur' : 'uyar'}). Bugün: $${today.toFixed(2)}`,
    }
  })

  on('command.run', { command: 'rapor' }, async $ => {
    const report = await buildReport($, await $.clock.now(), 0)
    await update($, reportAtom, () => report)
    const lines = [
      `📅 ${report.title}: toplam $${report.totalUsd.toFixed(2)} · ${report.turns} tur`,
      `Ortalama skor: ${report.avgScore === null ? '—' : Math.round(report.avgScore)} · ortalama prompt kalitesi: ${report.avgQuality === null ? '—' : report.avgQuality.toFixed(1)}`,
      ...report.projects.map(one => `· ${one.name}: $${one.usd.toFixed(2)}`),
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'test-komutu' }, async ($, e) => {
    const cwd = await $.session.cwd()
    const arg = e.args.trim()
    if (arg === 'sil') {
      await $.store.delete(`test-cmd:${cwd}`)
      return { text: 'Özel test komutu silindi; komut proje dosyalarından bulunacak.' }
    }
    if (!arg) {
      const custom = await $.store.get(`test-cmd:${cwd}`)
      return { text: typeof custom === 'string' ? `Test komutu: ${custom}` : 'Özel test komutu yok; proje dosyalarından bulunuyor.' }
    }
    await $.store.set(`test-cmd:${cwd}`, arg)
    return { text: `Bu projenin test komutu: ${arg}` }
  })

  // ---- the prompt -----------------------------------------------------------------

  // Paints a key red in the box while it is typed, before anything is sent.
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
      const mode = (await read($, settingsAtom)).secretMode
      await update($, warningAtom, old =>
        hasSecret
          ? `🔐 Taslakta anahtar var (gönderince: ${MODE_LABEL[mode]})`
          : old?.startsWith('🔐 Taslakta') ? null : old,
      )
    }
    return changed
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const set = await read($, settingsAtom)
    let text = e.text

    const kinds = findSecrets(text)
    if (kinds.length > 0) {
      const what = kinds.join(', ')
      await logEvent($, `Promptta ${what} (${MODE_LABEL[set.secretMode]})`)
      if (set.secretMode === 'block') {
        await update($, warningAtom, () => `🔐 Promptta ${what} var, gönderilmedi.`)
        return {
          drop: `🔐 Promptta ${what} tespit edildi, gönderilmedi. Anahtarı çıkar ya da /anahtar-koruma ile modu değiştir.`,
        }
      }
      if (set.secretMode === 'mask') {
        text = maskSecrets(text)
        $.ui.toast(`🔐 ${what} maskelendi.`)
      } else {
        await update($, warningAtom, () => `⚠ Promptta ${what} vardı ve modele gitti.`)
      }
    }

    if (set.budgetUsd !== null) {
      const today = await spendToday($, lastCost)
      if (today >= set.budgetUsd) {
        const note = `💰 Günlük bütçe doldu: $${today.toFixed(2)} / $${set.budgetUsd}`
        if (set.budgetMode === 'block') {
          await update($, warningAtom, () => `${note}. Gönderilmedi.`)
          return { drop: `${note}. /butce ile artır, kapat ya da 'uyar' moduna al.` }
        }
        await update($, warningAtom, () => note)
      }
    }

    const projectBudget = await read($, projectBudgetAtom)
    if (projectBudget !== null) {
      const cwd = await $.session.cwd()
      const spent = await projectToday($, await $.clock.now(), projectOf(cwd))
      if (spent >= projectBudget) {
        const note = `📁 ${projectOf(cwd)} proje bütçesi doldu: $${spent.toFixed(2)} / $${projectBudget}`
        if (set.budgetMode === 'block') {
          await update($, warningAtom, () => `${note}. Gönderilmedi.`)
          return { drop: `${note}. /butce proje <dolar> ile artır ya da 'uyar' moduna al.` }
        }
        await update($, warningAtom, () => note)
      }
    }

    turnTools = []
    hasEditedThisTurn = false
    await addHistory($, text.replace(/^\+\+\s*/, ''), projectOf(await $.session.cwd()))

    // A draft the İyileştir button filled, sent as it was: already English.
    const last = await read($, lastPromptAtom)
    if (last?.isPending && text.trim() === last.en.trim()) {
      await update($, lastPromptAtom, record => record && { ...record, isPending: false })
      lastUserText = last.original
      return next({ ...e, text, context: [...(e.context ?? []), turkishNote(last.original)] })
    }

    const hasPrefix = text.startsWith('++')
    if (hasPrefix) text = text.slice(2).trim()
    lastUserText = text
    const isAlways = set.improveMode === 'always' && text.length >= 12

    if (!hasPrefix && isVague(text)) {
      await addTip($, {
        id: 'vague',
        level: 'info',
        text: `"${short(text, 30)}" kısa kaldı: dosya, hedef ve beklenen sonucu yazarsan daha iyi sonuç alırsın (++ ile iyileştirebilirsin).`,
      })
    }

    if (!(hasPrefix || isAlways) || !text) return next({ ...e, text })

    await setBusy($, '⏳ Prompt iyileştiriliyor…')
    const improved = await improve($, text).catch(() => null)
    await setBusy($, null)
    if (!improved) {
      $.ui.toast('İyileştirme başarısız, prompt olduğu gibi gönderildi.')
      return next({ ...e, text })
    }
    await recordImproved($, text, improved, false)
    if (improved.quality !== null && improved.quality <= 4) {
      await addTip($, {
        id: 'quality',
        level: 'info',
        text: `Son promptun kalitesi ${improved.quality}/10. Eksik: ${improved.missing.join(', ') || '—'}`,
      })
    } else {
      await dropTip($, 'quality')
    }
    return next({
      ...e,
      text: improved.en,
      context: [...(e.context ?? []), turkishNote(text)],
    })
  }).catch(($, e, next) =>
    // The key guard fails closed: a prompt holding a key is not sent unchecked.
    next.called || findSecrets(e.text).length === 0
      ? next(e)
      : { drop: '🔐 Anahtar kontrolü hata verdi; promptta anahtar göründüğü için gönderilmedi.' },
  )

  // ---- tools ----------------------------------------------------------------------

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const isMain = input.agentId === undefined
    const set = await read($, settingsAtom)
    const path = [input.file_path, input.path, input.notebook_path].find(
      (one): one is string => typeof one === 'string',
    )
    const command = tool === 'Bash' && typeof input.command === 'string' ? input.command : undefined

    const touchesEnv =
      (path !== undefined && isSensitivePath(path)) || (command !== undefined && SENSITIVE_IN_COMMAND.test(command))
    if (touchesEnv) {
      const what = path !== undefined ? short(path.split('/').slice(-2).join('/'), 40) : short(command ?? '', 40)
      if (set.blockEnvRead) {
        await logEvent($, `Engellendi: ${tool} ${what}`)
        $.ui.toast('🔐 Hassas dosya erişimi engellendi.')
        return {
          deny: 'asistan: hassas dosyalara (.env, anahtarlar, kimlik bilgileri) erişim kullanıcı tarafından kapatıldı. İçeriğe ihtiyacın varsa kullanıcıdan değişken adlarını iste.',
        }
      }
      await logEvent($, `${tool}: ${what}`)
    }

    if (command !== undefined) {
      if (set.commitGuard && gitOps(command).length > 0) {
        const problems = await commitProblems($, command, await $.session.cwd())
        if (problems !== null) {
          await logEvent($, `Commit durduruldu: ${short(problems, 60)}`)
          $.ui.toast('🔐 Commit kontrolü: anahtar ya da .env bulundu, durduruldu.')
          return {
            deny: `asistan commit kontrolü: ${problems}. Bunları commit etme; kullanıcıya sor ya da dosyayı .gitignore'a ekle.`,
          }
        }
      }
      if (set.packageGuard && parseInstalls(command).length > 0) {
        const blocked = await checkInstalls($, command)
        if (blocked !== null) {
          $.ui.toast('📦 Şüpheli paket: kurulum durduruldu.')
          return {
            deny: `asistan paket kontrolü: ${blocked}. Bu paketi kurma; adın doğru olduğundan emin ol ya da kullanıcıya sor.`,
          }
        }
      }
      if (set.networkWatch) await noteUrls($, urlsIn(command))
      const risk = RISKY.find(one => one.re.test(command))
      if (risk) {
        $.ui.toast(`⚠ Riskli komut: ${risk.label}`)
        await addTip($, { id: `risk-${risk.label}`, level: 'warn', text: `Riskli komut çalıştı: ${short(command, 50)}` })
      }
    }

    if (set.networkWatch && tool === 'WebFetch' && typeof input.url === 'string') await noteUrls($, [input.url])
    const isEdit = EDIT_TOOLS.has(tool) && path !== undefined
    if (isEdit) await takeSnapshot($, path)

    if (isMain) turnTools.push(tool)
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      if (isEdit) {
        await markChanged($, path)
        if (isMain) hasEditedThisTurn = true
      }
      if (TASK_TOOLS.has(tool)) await applyTaskCall($, tool, input, typeof ran.text === 'string' ? ran.text : '')
    }

    const isDenied = ran.deny !== undefined
    const hasFailed = !isDenied && ran.isError === true
    await update($, metricsAtom, m => ({
      ...m,
      tools: m.tools + 1,
      failed: m.failed + (hasFailed ? 1 : 0),
      denied: m.denied + (isDenied ? 1 : 0),
    }))
    if (command !== undefined) {
      const key = command.trim().slice(0, 60)
      const count = hasFailed ? (failures.get(key) ?? 0) + 1 : 0
      failures.set(key, count)
      if (hasFailed) {
        const output = typeof ran.text === 'string' ? ran.text : ''
        const at = await $.clock.now()
        await update($, lastErrorAtom, () => ({
          command,
          output: maskOutput(short(output, 8000)).text,
          explanation: null,
          at,
        }))
      }
      if (count >= 3) {
        await addTip($, {
          id: `fail-${key}`,
          level: 'error',
          text: `Aynı komut ${count} kez başarısız: ${short(key, 40)}. Farklı bir yaklaşım iste.`,
        })
      }
    }
    return ran
  })

  // Masks keys in what a tool hands back before the model reads it.
  on('session.append', async ($, e, next) => {
    if (e.door !== 'tool-result') return next(e)
    if (!(await read($, settingsAtom)).maskToolOutput) return next(e)
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
    await logEvent($, `Araç çıktısında maskelendi: ${what}`)
    $.ui.toast(`🔐 Araç çıktısında ${what} maskelendi.`)
    return next({ ...e, message: { ...e.message, content } })
  })

  // ---- after each turn ------------------------------------------------------------

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    const set = await read($, settingsAtom)

    const usage: ModelUsage | undefined = e.usage
    const now = await $.clock.now()
    const su = await $.session.usage()
    const cost = su.cost?.usd ?? null
    const project = projectOf(await $.session.cwd())
    if (cost !== null && lastCost !== null && cost > lastCost) await bookCost($, now, project, cost - lastCost)
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
        text: `Context %${Math.round(ctx)} dolu: Özet'teki 🗜 Compact ya da yeni oturum öneririm.`,
      })
    } else {
      await dropTip($, 'ctx')
    }
    const cache = cachePctOf(m)
    if (cache !== null && cache < 50 && m.inputTokens + m.cacheRead + m.cacheWrite > 20000) {
      await addTip($, {
        id: 'cache',
        level: 'warn',
        text: `Cache isabeti %${cache}: model değiştirmek ya da 5 dk'dan uzun ara vermek cache'i sıfırlar.`,
      })
    } else {
      await dropTip($, 'cache')
    }
    if (m.tools >= 5 && m.failed / m.tools > 0.3) {
      await addTip($, {
        id: 'fails',
        level: 'warn',
        text: `Araç çağrılarının %${Math.round((m.failed / m.tools) * 100)}'i hata verdi. Ortamı ya da yaklaşımı gözden geçir.`,
      })
    } else {
      await dropTip($, 'fails')
    }

    // A rate-limit window past 80%: one desktop notification per window.
    for (const one of su.rateLimits) {
      if (one.percentUsed < 80) continue
      const key = `limit-notified:${one.kind}`
      const window = one.resetsAt ?? 'unknown'
      if ((await $.store.get(key)) === window) continue
      await $.store.set(key, window)
      await notifyDesktop(
        $,
        'Claude Code limiti',
        `${LIMIT_LABEL[one.kind] ?? one.kind} limiti %${Math.round(one.percentUsed)} doldu.`,
        false,
      )
    }

    if (set.budgetUsd !== null && m.todayUsd !== null) {
      const day = dayKey(now)
      if (m.todayUsd >= set.budgetUsd * 0.8 && budgetWarnedDay !== day) {
        budgetWarnedDay = day
        $.ui.toast(`💰 Günlük bütçenin %${Math.round((m.todayUsd / set.budgetUsd) * 100)}'i kullanıldı.`)
      }
    }

    const isLong = set.notifyAfterSec !== null && e.durationMs >= set.notifyAfterSec * 1000
    if (isLong) {
      const cwd = await $.session.cwd()
      const seconds = Math.round(e.durationMs / 1000)
      const took = seconds >= 60 ? `${Math.floor(seconds / 60)} dk ${seconds % 60} sn` : `${seconds} sn`
      void notifyDesktop($, 'Claude Code: tur bitti', `${cwd.split('/').pop() ?? ''} · ${took}`, set.sound)
    }

    await refreshStatus($)
    const answer = e.answer
    const tools = turnTools
    const userText = lastUserText
    $.clock.after(50, () => void afterTurn($, answer, tools, userText, set, isLong))
    return done
  })

  // ---- drawing ------------------------------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) =>
    e.props.hasSurvey ? next(e) : renderBand($, e),
  )

  on('ui.render', { component: 'Pane', requestId: 'asistan' }, async ($, e) => renderPane($, e))
}
