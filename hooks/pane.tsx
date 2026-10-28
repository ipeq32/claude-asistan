import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { AsistanSettings, Lang, Tab, Template } from '../types'
import {
  changeSettings,
  copyBlock,
  explainError,
  fillTemplate,
  improveDraft,
  revertFile,
  runTests,
  saveTemplates,
  scanEnv,
  sendTestsToClaude,
  showDiff,
  suggestCommit,
} from './actions'
import {
  exportSettings,
  importSettings,
  ollamaModels,
  remoteChannels,
  scanDependencies,
  scanGitHistory,
  sendRemote,
  shareTemplate,
} from './extra'
import { MODE_LABEL, NEXT_MODE, bar, cachePctOf, projectOf, say, short, sparkline, usd } from './lib'
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
const reportAtom = atom({ plugin: 'asistan', key: 'report' } as const, null, { shape: 'report-1' })
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
const codeBlocksAtom = atom({ plugin: 'asistan', key: 'codeBlocks' } as const, [], { shape: 'code-1' })
const networkAtom = atom({ plugin: 'asistan', key: 'network' } as const, [], { shape: 'net-1' })
const packagesAtom = atom({ plugin: 'asistan', key: 'packages' } as const, [], { shape: 'packages-1' })
const glossaryAtom = atom({ plugin: 'asistan', key: 'glossary' } as const, [], { shape: 'glossary-1' })
const timelineAtom = atom({ plugin: 'asistan', key: 'timeline' } as const, [], { shape: 'timeline-1' })
const turnStatsAtom = atom({ plugin: 'asistan', key: 'turnStats' } as const, [], { shape: 'turns-1' })
const vulnScanAtom = atom({ plugin: 'asistan', key: 'vulnScan' } as const, null, { shape: 'vulns-1' })
const historyScanAtom = atom({ plugin: 'asistan', key: 'historyScan' } as const, null, { shape: 'hscan-1' })
const teamTemplatesAtom = atom({ plugin: 'asistan', key: 'teamTemplates' } as const, [], { shape: 'team-1' })
const estimateAtom = atom({ plugin: 'asistan', key: 'estimate' } as const, null)
const warningAtom = atom({ plugin: 'asistan', key: 'warning' } as const, null)
const busyAtom = atom({ plugin: 'asistan', key: 'busy' } as const, null)
const tabAtom = atom({ plugin: 'asistan', key: 'tab' } as const, 'ozet')
const turnSummaryAtom = atom({ plugin: 'asistan', key: 'turnSummary' } as const, null)
const commitSuggestionAtom = atom({ plugin: 'asistan', key: 'commitSuggestion' } as const, null)
const historyQueryAtom = atom({ plugin: 'asistan', key: 'historyQuery' } as const, '')
const glossaryQueryAtom = atom({ plugin: 'asistan', key: 'glossaryQuery' } as const, '')
const confirmRevertAtom = atom({ plugin: 'asistan', key: 'confirmRevert' } as const, null)
const projectBudgetAtom = atom({ plugin: 'asistan', key: 'projectBudget' } as const, null)

export const PANE = 'asistan'
export const PANE_TITLE = 'Asistan'

const TABS: { id: Tab; tr: string; en: string; hotkey: string }[] = [
  { id: 'ozet', tr: 'Özet', en: 'Summary', hotkey: '1' },
  { id: 'prompt', tr: 'Prompt', en: 'Prompt', hotkey: '2' },
  { id: 'guvenlik', tr: 'Güvenlik', en: 'Security', hotkey: '3' },
  { id: 'kod', tr: 'Kod', en: 'Code', hotkey: '4' },
  { id: 'zaman', tr: 'Zaman', en: 'Timeline', hotkey: '5' },
  { id: 'sozluk', tr: 'Sözlük', en: 'Glossary', hotkey: '6' },
  { id: 'ayarlar', tr: 'Ayarlar', en: 'Settings', hotkey: '7' },
]

const NOTIFY_STEPS: (number | null)[] = [30, 60, 120, 300, null]

type Flag =
  | 'maskToolOutput'
  | 'commitGuard'
  | 'blockEnvRead'
  | 'packageGuard'
  | 'networkWatch'
  | 'sound'
  | 'speakSummary'
  | 'turnSummary'
  | 'glossary'
  | 'modelHints'
  | 'autoTests'
  | 'remoteNotify'
  | 'rulesCheck'
  | 'costEstimate'

function flip($: EngineInterface, field: Flag) {
  return changeSettings($, old => ({ ...old, [field]: !old[field] }))
}

const nextNotify = (value: number | null) =>
  NOTIFY_STEPS[(NOTIFY_STEPS.indexOf(value) + 1) % NOTIFY_STEPS.length] ?? null

const ms = (value: number) => (value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`)

async function saveLastPrompt($: EngineInterface, lang: Lang) {
  const last = await read($, lastPromptAtom)
  if (last === null) {
    $.ui.toast(say(lang, 'Kaydedilecek prompt yok.', 'No prompt to save.'))
    return
  }
  const base = last.original.split(/\s+/).slice(0, 3).join(' ').slice(0, 24) || say(lang, 'şablon', 'template')
  await saveTemplates($, list => {
    let name = base
    for (let i = 2; list.some(one => one.name === name); i += 1) name = `${base} ${i}`
    return [...list, { name, text: last.original }].slice(-12)
  })
  $.ui.toast(say(lang, 'Şablon kaydedildi.', 'Template saved.'))
}

async function setProjectBudget($: EngineInterface, value: number | null) {
  const project = projectOf(await $.session.cwd())
  await update($, projectBudgetAtom, () => value)
  await $.store.set(`proj-budget:${project}`, value)
}

async function fillHistory($: EngineInterface, text: string, lang: Lang) {
  await $.prompt.fill({ text, mode: 'replace' })
  $.ui.toast(say(lang, 'Geçmişten kutuya yazıldı.', 'Put back in the box from history.'))
}

async function share($: EngineInterface, template: Template, lang: Lang) {
  await shareTemplate($, await $.session.cwd(), template)
  $.ui.toast(say(lang, `"${template.name}" .asistan/sablonlar.json dosyasına eklendi.`, `"${template.name}" added to .asistan/sablonlar.json.`))
}

// Haiku, then each local Ollama model, then Haiku again.
async function cycleModel($: EngineInterface, lang: Lang) {
  const set = await read($, settingsAtom)
  const models = await ollamaModels($)
  if (models === null || models.length === 0) {
    if (set.modelProvider === 'ollama') await changeSettings($, old => ({ ...old, modelProvider: 'haiku', ollamaModel: null }))
    $.ui.toast(
      say(lang, "Ollama'ya ulaşılamadı ya da model yok (localhost:11434). Haiku kullanılıyor.", 'Ollama is not reachable or has no models (localhost:11434). Using Haiku.'),
    )
    return
  }
  const choices = ['haiku', ...models]
  const current = set.modelProvider === 'haiku' ? 'haiku' : (set.ollamaModel ?? 'haiku')
  const chosen = choices[(choices.indexOf(current) + 1) % choices.length] ?? 'haiku'
  await changeSettings($, old =>
    chosen === 'haiku' ? { ...old, modelProvider: 'haiku', ollamaModel: null } : { ...old, modelProvider: 'ollama', ollamaModel: chosen },
  )
}

async function testRemote($: EngineInterface, lang: Lang) {
  const sent = await sendRemote($, say(lang, '✅ asistan: test bildirimi', '✅ asistan: test notification'))
  $.ui.toast(
    sent.length
      ? say(lang, `Gönderildi: ${sent.join(', ')}`, `Sent: ${sent.join(', ')}`)
      : say(lang, 'Kanal yok: /bildirim ile kurulumu gör.', 'No channel set up: see /bildirim.'),
  )
}

async function exportFromPane($: EngineInterface, lang: Lang) {
  const file = await exportSettings($, '').catch(() => null)
  $.ui.toast(file ? say(lang, `Yazıldı: ${file}`, `Written: ${file}`) : say(lang, 'Yazılamadı.', 'Could not write it.'))
}

async function importFromPane($: EngineInterface, lang: Lang) {
  const done = await importSettings($, '').catch(() => null)
  $.ui.toast(done ? say(lang, `Okundu: ${done.file}`, `Read ${done.file}`) : say(lang, 'Okunamadı: ~/asistan-ayarlar.json', 'Could not read ~/asistan-ayarlar.json'))
}

const STATUS_MARK = { pending: '○', in_progress: '◐', completed: '✓' } as const

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Button, Code, Text } = elements
  // Mobile draws no text field: the search lists stand without one there.
  const Input = 'Input' in elements ? elements.Input : null
  const width = Math.max(20, e.props.bodyColumns)
  const current = await read($, tabAtom)
  const set = await read($, settingsAtom)
  const lang = set.language
  const t = (tr: string, en: string) => say(lang, tr, en)
  const room = Math.max(60, width * 6)
  const onOff = (value: boolean) => (value ? t('Açık', 'On') : t('Kapalı', 'Off'))

  const toggle = (label: string, key: string, value: string, onPress: () => unknown) => (
    <Box>
      <Text>{label}: </Text>
      <Button key={key} label={value} onPress={() => void onPress()} />
    </Box>
  )
  const heading = (text: string) => <Text bold>{text}</Text>
  const gap = <Text> </Text>

  const tabBar = (
    <Box flexWrap="wrap">
      {TABS.map(one => (
        <Button
          key={`tab-${one.id}`}
          label={say(lang, one.tr, one.en)}
          hotkey={one.hotkey}
          variant={one.id === current ? 'primary' : 'secondary'}
          onPress={() => update($, tabAtom, () => one.id)}
        />
      ))}
    </Box>
  )

  const ozet = async () => {
    const m = await read($, metricsAtom)
    const tipList = await read($, tipsAtom)
    const summary = await read($, turnSummaryAtom)
    const agentRows = await read($, agentsAtom)
    const error = await read($, lastErrorAtom)
    const report = await read($, reportAtom)
    const tasks = await read($, tasksAtom)
    const tests = await read($, testsAtom)
    const trends = await read($, trendsAtom)
    const projectBudget = await read($, projectBudgetAtom)
    const scoreColor = m.score === null ? 'subtle' : m.score >= 80 ? 'success' : m.score >= 60 ? 'warning' : 'error'
    const scoreBar = bar(m.score ?? 0, Math.max(5, Math.min(20, width - 14)))
    const cache = cachePctOf(m)
    const budgetPct = set.budgetUsd !== null && m.todayUsd !== null ? (m.todayUsd / set.budgetUsd) * 100 : null
    const done = tasks.filter(one => one.status === 'completed').length
    return (
      <Box flexDirection="column">
        {report !== null && (
          <Box flexDirection="column">
            {heading(`📅 ${t('Haftalık rapor', 'Weekly report')} (${report.title})`)}
            <Text>
              {t('Toplam', 'Total')} {usd(report.totalUsd)} <Text color="suggestion">{sparkline(report.days)}</Text> · {report.turns}{' '}
              {t('tur', 'turns')}
            </Text>
            <Text dimColor>
              {t('ort. skor', 'avg. score')} {report.avgScore === null ? '—' : Math.round(report.avgScore)} ·{' '}
              {t('ort. prompt kalitesi', 'avg. prompt quality')} {report.avgQuality === null ? '—' : report.avgQuality.toFixed(1)}
            </Text>
            {report.projects.slice(0, 3).map(one => (
              <Text dimColor>
                · {one.name} {usd(one.usd)}
              </Text>
            ))}
            <Button key="report-close" label={t('Kapat', 'Close')} onPress={() => update($, reportAtom, () => null)} />
            {gap}
          </Box>
        )}
        <Text bold>
          📊 {t('Verimlilik', 'Efficiency')} <Text color={scoreColor}>{m.score ?? '—'}/100</Text>
        </Text>
        <Text>
          <Text color={scoreColor}>{scoreBar.filled}</Text>
          <Text dimColor>{scoreBar.empty}</Text>
          {trends.score.some(one => one > 0) && <Text dimColor> 14{t('g', 'd')} {sparkline(trends.score)}</Text>}
        </Text>
        <Text dimColor>
          cache {cache === null ? '—' : `%${cache}`} · ctx {m.ctxPct === null ? '—' : `%${Math.round(m.ctxPct)}`} · {t('hata', 'failed')}{' '}
          {m.failed}/{m.tools}
        </Text>
        {m.limits.length > 0 && <Text dimColor>limit {m.limits.map(one => `${one.kind} %${Math.round(one.pct)}`).join(' · ')}</Text>}
        {gap}
        {heading(`💰 ${t('Maliyet', 'Cost')}`)}
        <Text>
          {t('oturum', 'session')} {usd(m.costUsd)} · {t('bugün', 'today')}{' '}
          <Text color={budgetPct === null ? 'text' : budgetPct >= 100 ? 'error' : budgetPct >= 80 ? 'warning' : 'success'}>
            {usd(m.todayUsd)}
            {set.budgetUsd !== null ? ` / $${set.budgetUsd}` : ''}
          </Text>
        </Text>
        <Text dimColor>
          {t('bu proje bugün', 'this project today')} {usd(m.projectTodayUsd)}
          {projectBudget !== null ? ` / $${projectBudget}` : ''}
        </Text>
        {m.weekDays.length > 0 && (
          <Text>
            7 {t('gün', 'days')} <Text color="suggestion">{sparkline(m.weekDays)}</Text> <Text dimColor>{usd(m.weekUsd)}</Text>
          </Text>
        )}
        {m.projects.slice(0, 4).map(one => (
          <Text dimColor>
            · {one.name} {usd(one.usd)}
          </Text>
        ))}
        {(m.ctxPct ?? 0) >= 50 && (
          <Button
            key="compact"
            label={`🗜 Compact (ctx %${Math.round(m.ctxPct ?? 0)})`}
            onPress={async () => {
              const result = await $.session.compact().catch(() => null)
              $.ui.toast(result === null ? t('Tur sürerken compact yapılamaz.', 'Cannot compact while a turn runs.') : t('Compact başladı.', 'Compacting.'))
            }}
          />
        )}
        {tasks.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`📋 ${t('Görevler', 'Tasks')} ${done}/${tasks.length}`)}
            {tasks.slice(0, 8).map(one => (
              <Text
                color={one.status === 'completed' ? 'success' : one.status === 'in_progress' ? 'warning' : 'text'}
                dimColor={one.status === 'completed'}
              >
                {STATUS_MARK[one.status]} {short(one.title, Math.max(20, width - 4))}
              </Text>
            ))}
          </Box>
        )}
        {tests !== null && tests.state !== 'none' && (
          <Text color={tests.state === 'pass' ? 'success' : tests.state === 'fail' ? 'error' : 'warning'}>
            🧪 {tests.state === 'pass' ? '✓' : tests.state === 'fail' ? '✗' : '…'} {short(tests.summary, Math.max(20, width - 6))}
          </Text>
        )}
        {summary !== null && (
          <Box flexDirection="column">
            {gap}
            {heading(`🧾 ${t('Son tur', 'Last turn')}`)}
            <Text>{summary}</Text>
          </Box>
        )}
        {agentRows.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`🤖 ${t('Ajanlar', 'Agents')}`)}
            {agentRows.map(row => (
              <Button
                key={`agent-${row.id}`}
                plain
                onPress={async () => {
                  const viewed = await $.ui.view({ agentId: row.id })
                  if ('deny' in viewed && viewed.deny) $.ui.toast(`${t('Açılamadı', 'Could not open')}: ${viewed.deny}`)
                }}
              >
                {row.label} <Text dimColor>{row.status}</Text>
              </Button>
            ))}
          </Box>
        )}
        {error !== null && (
          <Text color="error" wrap="truncate-end">
            ❌ {t('Son hata', 'Last error')}: {short(error.command, 40)} (4)
          </Text>
        )}
        {gap}
        {heading(`💡 ${t('Öneriler', 'Tips')}`)}
        {tipList.length === 0 && <Text dimColor>{t('Şimdilik her şey yolunda.', 'All good for now.')}</Text>}
        {tipList.map(tip => (
          <Text color={tip.level === 'error' ? 'error' : tip.level === 'warn' ? 'warning' : 'text'}>• {tip.text}</Text>
        ))}
      </Box>
    )
  }

  const prompt = async () => {
    const last = await read($, lastPromptAtom)
    const list = await read($, templatesAtom)
    const team = await read($, teamTemplatesAtom)
    const history = await read($, historyAtom)
    const query = (await read($, historyQueryAtom)).toLocaleLowerCase('tr')
    const trends = await read($, trendsAtom)
    const matches = history
      .filter(one => !query || one.text.toLocaleLowerCase('tr').includes(query))
      .slice(-6)
      .reverse()
    return (
      <Box flexDirection="column">
        {toggle(t('İyileştirme', 'Improving'), 'improve-mode', set.improveMode === 'always' ? t('her prompt', 'every prompt') : t('++ ön eki', '++ prefix'), () =>
          changeSettings($, old => ({ ...old, improveMode: old.improveMode === 'always' ? 'prefix' : 'always' })),
        )}
        <Button
          key="improve-now"
          label={t('✨ Kutudakini iyileştir', '✨ Improve the draft')}
          onPress={async () => improveDraft($, (await $.prompt.read()).text)}
        />
        {gap}
        {last === null && <Text dimColor>{t("Henüz iyileştirilmiş prompt yok. ++ ile başla ya da ✨'e bas.", 'No improved prompt yet. Start with ++ or press ✨.')}</Text>}
        {last !== null && (
          <Box flexDirection="column">
            {last.quality !== null && (
              <Text bold>
                {t('Kalite', 'Quality')}{' '}
                <Text color={last.quality >= 7 ? 'success' : last.quality >= 4 ? 'warning' : 'error'}>{last.quality}/10</Text>
                {trends.quality.some(one => one > 0) && <Text dimColor> 14{t('g', 'd')} {sparkline(trends.quality)}</Text>}
              </Text>
            )}
            {last.missing.length > 0 && <Text color="warning">{t('Eksik', 'Missing')}: {last.missing.join(', ')}</Text>}
            {last.added.length > 0 && <Text color="success">{t('Eklenen', 'Added')}: {last.added.join(', ')}</Text>}
            <Text dimColor>{t('Yazdığın', 'You wrote')}:</Text>
            <Text>{short(last.original, room)}</Text>
            <Text color="suggestion">
              {t('Gönderilen (EN)', 'Sent (EN)')}
              {last.isPending ? t(' · kutuda bekliyor', ' · waiting in the box') : ''}:
            </Text>
            <Text>{short(last.en, room)}</Text>
            {lang === 'tr' && <Text color="success">Türkçesi:</Text>}
            {lang === 'tr' && <Text>{short(last.tr, room)}</Text>}
          </Box>
        )}
        {gap}
        {heading(`🕘 ${t('Geçmiş', 'History')}`)}
        {Input !== null && (
          <Input
            key="history-q"
            placeholder={t('ara…', 'search…')}
            value={query}
            onInput={(value: string) => void update($, historyQueryAtom, () => value)}
            onSubmit={(value: string) => void update($, historyQueryAtom, () => value)}
          />
        )}
        {matches.length === 0 && <Text dimColor>{history.length ? t('Eşleşme yok.', 'No match.') : t('Henüz geçmiş yok.', 'No history yet.')}</Text>}
        {matches.map(one => (
          <Button key={`hist-${one.at}`} plain onPress={() => fillHistory($, one.text, lang)}>
            ▸ {short(one.text, Math.max(20, width - 14))} <Text dimColor>{one.project}</Text>
          </Button>
        ))}
        {gap}
        {heading(`📚 ${t('Şablonlar', 'Templates')}`)}
        {list.length === 0 && team.length === 0 && (
          <Text dimColor>{t('Kayıtlı şablon yok. /sablon kaydet <ad> <metin>', 'No saved templates. /sablon kaydet <name> <text>')}</Text>
        )}
        {list.map((template: Template) => (
          <Box>
            <Button key={`tpl-${template.name}`} plain onPress={() => fillTemplate($, template)}>
              ▸ {template.name} <Text dimColor>{short(template.text, 26)}</Text>
            </Button>
            <Button key={`share-${template.name}`} label="👥" plain onPress={() => share($, template, lang)} />
          </Box>
        ))}
        {team.map((template: Template) => (
          <Button key={`team-${template.name}`} plain onPress={() => fillTemplate($, template)}>
            👥 {template.name} <Text dimColor>{short(template.text, 26)}</Text>
          </Button>
        ))}
        {last !== null && <Button key="save-last" label={t('💾 Son promptu kaydet', '💾 Save the last prompt')} onPress={() => saveLastPrompt($, lang)} />}
      </Box>
    )
  }

  const guvenlik = async () => {
    const s = await read($, envAtom)
    const evs = await read($, eventsAtom)
    const packages = await read($, packagesAtom)
    const network = await read($, networkAtom)
    const vulns = await read($, vulnScanAtom)
    const hscan = await read($, historyScanAtom)
    const problems = s.tracked.length + s.unignored.length
    return (
      <Box flexDirection="column">
        {heading(`🔐 ${t('.env dosyaları', '.env files')}`)}
        {!s.isChecked && <Text dimColor>{t('Taranıyor…', 'Scanning…')}</Text>}
        {s.isChecked && s.files.length === 0 && <Text dimColor>{t('.env dosyası yok', 'No .env files')}</Text>}
        {s.isChecked && s.files.length > 0 && problems === 0 && (
          <Text color="success">✓ {s.files.length} .env, {t('hepsi git dışında', 'all kept out of git')}</Text>
        )}
        {s.tracked.map(file => (
          <Text color="error">❌ {t("git'te", 'in git')}: {file}</Text>
        ))}
        {s.unignored.map(file => (
          <Text color="warning">⚠ {t('ignore değil', 'not ignored')}: {file}</Text>
        ))}
        <Button key="rescan" label={t('🔄 Yeniden tara', '🔄 Rescan')} onPress={async () => scanEnv($, await $.session.cwd())} />
        {gap}
        {heading(`🛡 ${t('Korumalar', 'Guards')}`)}
        {toggle(t('Promptta anahtar', 'Key in a prompt'), 'secret-mode', MODE_LABEL[lang][set.secretMode], () =>
          changeSettings($, old => ({ ...old, secretMode: NEXT_MODE[old.secretMode] })),
        )}
        {toggle(t('Araç çıktısını maskele', 'Mask tool output'), 'mask-output', onOff(set.maskToolOutput), () => flip($, 'maskToolOutput'))}
        {toggle(t('Git kontrolü (add/commit/push)', 'Git check (add/commit/push)'), 'commit-guard', onOff(set.commitGuard), () => flip($, 'commitGuard'))}
        {toggle(t('Hassas dosya okuma', 'Reading sensitive files'), 'env-read', set.blockEnvRead ? t('Yasak', 'Blocked') : t('Serbest', 'Allowed'), () =>
          flip($, 'blockEnvRead'),
        )}
        {toggle(t('Paket kontrolü', 'Package check'), 'package-guard', onOff(set.packageGuard), () => flip($, 'packageGuard'))}
        {toggle(t('Ağ izleme', 'Network watch'), 'network-watch', onOff(set.networkWatch), () => flip($, 'networkWatch'))}
        {gap}
        {heading(`🧬 ${t('Bağımlılık açıkları', 'Dependency vulnerabilities')}`)}
        <Button
          key="vuln-scan"
          label={vulns?.state === 'running' ? t('⏳ Taranıyor…', '⏳ Scanning…') : t('Bağımlılıkları tara (OSV)', 'Scan dependencies (OSV)')}
          onPress={async () => scanDependencies($, await $.session.cwd())}
        />
        {vulns?.state === 'done' && vulns.checked > 0 && vulns.rows.length === 0 && (
          <Text color="success">✓ {t(`${vulns.checked} pakette bilinen açık yok`, `no known vulnerabilities in ${vulns.checked} packages`)}</Text>
        )}
        {vulns?.rows.map(row => (
          <Text color="error" wrap="truncate-end">
            ⚠ {row.name}@{row.version} <Text dimColor>{row.ids.join(', ')}</Text>
          </Text>
        ))}
        {vulns?.note ? <Text dimColor>{vulns.note}</Text> : null}
        {gap}
        {heading(`🕵 ${t('Git geçmişi', 'Git history')}`)}
        <Button
          key="history-scan"
          label={hscan?.state === 'running' ? t('⏳ Taranıyor…', '⏳ Scanning…') : t('Geçmişte anahtar ara', 'Search history for keys')}
          onPress={async () => {
            const cwd = await $.session.cwd()
            $.clock.after(0, () => void scanGitHistory($, cwd))
          }}
        />
        {hscan?.state === 'done' && hscan.hits.length === 0 && hscan.commits > 0 && (
          <Text color="success">✓ {t(`${hscan.commits} commit temiz`, `${hscan.commits} commits clean`)}</Text>
        )}
        {hscan?.hits.slice(0, 10).map(hit => (
          <Text color="error" wrap="truncate-end">
            ❌ {hit.sha} {hit.file} <Text dimColor>{hit.kind}</Text>
          </Text>
        ))}
        {hscan?.note ? <Text dimColor>{hscan.note}</Text> : null}
        {packages.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`📦 ${t('Paketler', 'Packages')}`)}
            {packages
              .slice()
              .reverse()
              .map(one => (
                <Text color={one.verdict === 'block' ? 'error' : one.verdict === 'warn' ? 'warning' : 'text'} wrap="truncate-end">
                  {one.verdict === 'block' ? '⛔' : one.verdict === 'warn' ? '⚠' : '✓'} {one.name} <Text dimColor>{one.note}</Text>
                </Text>
              ))}
          </Box>
        )}
        {network.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`🌐 ${t('Ağ', 'Network')}`)}
            {network
              .slice()
              .sort((a, b) => b.count - a.count)
              .map(one => (
                <Text color={one.isKnown ? 'text' : 'warning'} dimColor={one.isKnown}>
                  {one.isKnown ? '·' : '⚠'} {one.domain} ×{one.count}
                </Text>
              ))}
          </Box>
        )}
        {gap}
        {heading(`📜 ${t('Olaylar', 'Events')}`)}
        {evs.length === 0 && <Text dimColor>{t('Olay yok.', 'No events.')}</Text>}
        {evs.map(ev => (
          <Text dimColor wrap="truncate-end">
            · {ev.text}
          </Text>
        ))}
      </Box>
    )
  }

  const kod = async () => {
    const files = await read($, changedFilesAtom)
    const diff = await read($, diffViewAtom)
    const confirm = await read($, confirmRevertAtom)
    const tests = await read($, testsAtom)
    const error = await read($, lastErrorAtom)
    const suggestion = await read($, commitSuggestionAtom)
    const blocks = await read($, codeBlocksAtom)
    const cwd = await $.session.cwd()
    const rel = (path: string) => (path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)
    return (
      <Box flexDirection="column">
        {heading(`📂 ${t('Değişen dosyalar', 'Changed files')} (${files.length})`)}
        {files.length === 0 && <Text dimColor>{t('Bu oturumda düzenlenen dosya yok.', 'No file edited this session.')}</Text>}
        {files
          .slice()
          .reverse()
          .map(file => (
            <Box flexDirection="column">
              <Button key={`file-${file.path}`} plain onPress={() => showDiff($, file.path)}>
                {diff?.path === file.path ? '▾' : '▸'} {short(rel(file.path), Math.max(20, width - 12))}{' '}
                <Text dimColor>{file.isNew ? t('yeni', 'new') : `×${file.edits}`}</Text>
              </Button>
              {diff?.path === file.path && (
                <Box flexDirection="column">
                  <Code
                    source={diff.text.split('\n').slice(0, 120).join('\n')}
                    format={diff.text.startsWith('---') ? 'diff' : 'source'}
                    path={file.path}
                  />
                  {confirm === file.path ? (
                    <Box>
                      <Text color="warning">
                        {file.isNew ? t('Dosya silinsin mi? ', 'Delete the file? ') : t('Oturum başındaki haline dönsün mü? ', 'Revert to its state before this session? ')}
                      </Text>
                      <Button key={`revert-yes-${file.path}`} label={t('Evet', 'Yes')} variant="primary" onPress={() => revertFile($, file.path)} />
                      <Button key={`revert-no-${file.path}`} label={t('Vazgeç', 'Cancel')} onPress={() => update($, confirmRevertAtom, () => null)} />
                    </Box>
                  ) : (
                    file.hasSnapshot && (
                      <Button
                        key={`revert-${file.path}`}
                        label={file.isNew ? t('🗑 Sil', '🗑 Delete') : t('↩ Geri al', '↩ Revert')}
                        onPress={() => update($, confirmRevertAtom, () => file.path)}
                      />
                    )
                  )}
                </Box>
              )}
            </Box>
          ))}
        {gap}
        {heading(`🧪 ${t('Testler', 'Tests')}`)}
        {tests === null && <Text dimColor>{t('Henüz çalıştırılmadı.', 'Not run yet.')}</Text>}
        {tests !== null && (
          <Text color={tests.state === 'pass' ? 'success' : tests.state === 'fail' ? 'error' : tests.state === 'running' ? 'warning' : 'subtle'}>
            {tests.state === 'pass' ? '✓' : tests.state === 'fail' ? '✗' : tests.state === 'running' ? '⏳' : '·'} {tests.summary}
          </Text>
        )}
        {tests !== null && tests.command !== '' && <Text dimColor>$ {tests.command}</Text>}
        {tests?.state === 'fail' && <Text dimColor>{tests.output.split('\n').slice(-8).join('\n')}</Text>}
        <Box>
          <Button key="tests-run" label={t('▶ Çalıştır', '▶ Run')} onPress={() => runTests($)} />
          {tests?.state === 'fail' && <Button key="tests-send" label={t("Claude'a gönder", 'Send to Claude')} onPress={() => sendTestsToClaude($)} />}
        </Box>
        {gap}
        {heading(`❌ ${t('Son hata', 'Last error')}`)}
        {error === null && <Text dimColor>{t('Bu oturumda başarısız komut yok.', 'No failed command this session.')}</Text>}
        {error !== null && (
          <Box flexDirection="column">
            <Text color="error" wrap="truncate-end">
              $ {error.command}
            </Text>
            <Text dimColor>{error.output.split('\n').slice(-6).join('\n')}</Text>
            {error.explanation === null ? (
              <Button key="explain" label={t('🇹🇷 Türkçe açıkla', '💬 Explain')} onPress={() => explainError($)} />
            ) : (
              <Text>{error.explanation}</Text>
            )}
          </Box>
        )}
        {gap}
        {heading('📝 Commit')}
        <Button key="commit" label={t('Commit mesajı öner', 'Suggest a commit message')} onPress={() => suggestCommit($)} />
        {suggestion !== null && <Text dimColor>{suggestion}</Text>}
        {blocks.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`📋 ${t('Son cevaptaki kodlar', 'Code in the last reply')}`)}
            {blocks.map((block, i) => (
              <Button key={`copy-${i}`} plain onPress={press => copyBlock($, block, press.surface)}>
                ⧉ <Text color="suggestion">{block.lang}</Text> {short(block.text.split('\n')[0] ?? '', Math.max(16, width - 16))}{' '}
                <Text dimColor>
                  {block.text.split('\n').length} {t('satır', 'lines')}
                </Text>
              </Button>
            ))}
          </Box>
        )}
      </Box>
    )
  }

  const zaman = async () => {
    const rows = await read($, timelineAtom)
    const turns = await read($, turnStatsAtom)
    const slowest = rows
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
    const recent = rows.slice(-12).reverse()
    const longest = Math.max(1, ...recent.map(one => one.ms))
    const barRoom = Math.max(4, Math.min(12, width - 30))
    const costly = turns
      .slice()
      .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)
      .slice(0, 5)
    return (
      <Box flexDirection="column">
        {heading(`⏱ ${t('En yavaş çağrılar', 'Slowest calls')}`)}
        {slowest.length === 0 && <Text dimColor>{t('Henüz araç çağrısı yok.', 'No tool calls yet.')}</Text>}
        {slowest.map(one => (
          <Text wrap="truncate-end">
            <Text color="warning">{ms(one.ms).padStart(6)}</Text> {one.tool} <Text dimColor>{one.label}</Text>
          </Text>
        ))}
        {gap}
        {heading(`🕘 ${t('Son çağrılar', 'Recent calls')}`)}
        {recent.map(one => (
          <Text wrap="truncate-end">
            <Text color={one.isOk ? 'success' : 'error'}>{'▇'.repeat(Math.max(1, Math.round((one.ms / longest) * barRoom))).padEnd(barRoom)}</Text>{' '}
            <Text dimColor>{ms(one.ms).padStart(6)}</Text> {one.tool} <Text dimColor>{one.label}</Text>
          </Text>
        ))}
        {gap}
        {heading(`🔥 ${t('En pahalı turlar', 'Costliest turns')}`)}
        {costly.length === 0 && <Text dimColor>{t('Henüz tamamlanan tur yok.', 'No finished turns yet.')}</Text>}
        {costly.map(one => (
          <Text wrap="truncate-end">
            #{one.turn} <Text color="warning">{usd(one.usd)}</Text> · {Math.round(one.tokens / 1000)}k token · {ms(one.ms)}{' '}
            <Text dimColor>{one.label}</Text>
          </Text>
        ))}
      </Box>
    )
  }

  const sozluk = async () => {
    const terms = await read($, glossaryAtom)
    const query = (await read($, glossaryQueryAtom)).toLocaleLowerCase('tr')
    const shown = terms
      .filter(one => !query || one.term.toLowerCase().includes(query) || one.tr.toLocaleLowerCase('tr').includes(query))
      .slice(-30)
      .reverse()
    return (
      <Box flexDirection="column">
        {heading(`📖 ${t('Terimler', 'Terms')} (${terms.length})`)}
        {Input !== null && (
          <Input
            key="gloss-q"
            placeholder={t('ara…', 'search…')}
            value={query}
            onInput={(value: string) => void update($, glossaryQueryAtom, () => value)}
            onSubmit={(value: string) => void update($, glossaryQueryAtom, () => value)}
          />
        )}
        {terms.length === 0 && (
          <Text dimColor>{t('Cevaplarda geçen İngilizce terimler burada toplanacak.', 'English technical terms from the replies collect here.')}</Text>
        )}
        {shown.map(one => (
          <Text>
            <Text bold color="suggestion">
              {one.term}
            </Text>{' '}
            — {one.tr}
          </Text>
        ))}
      </Box>
    )
  }

  const ayarlar = async () => {
    const projectBudget = await read($, projectBudgetAtom)
    const channels = await remoteChannels($)
    const budgetStep = (delta: number) =>
      changeSettings($, (old: AsistanSettings) => ({ ...old, budgetUsd: Math.max(1, (old.budgetUsd ?? 0) + delta) }))
    return (
      <Box flexDirection="column">
        {heading(`🌍 ${t('Genel', 'General')}`)}
        {toggle(t('Dil', 'Language'), 'language', lang === 'tr' ? 'Türkçe' : 'English', () =>
          changeSettings($, old => ({ ...old, language: old.language === 'tr' ? 'en' : 'tr' })),
        )}
        {toggle(
          t('Asistanın modeli', "The mod's model"),
          'model-provider',
          set.modelProvider === 'ollama' ? `🏠 ${set.ollamaModel ?? '?'}` : 'Haiku',
          () => cycleModel($, lang),
        )}
        {gap}
        {heading(`🔔 ${t('Bildirim', 'Notifications')}`)}
        {toggle(t('Uzun tur bitince', 'When a long turn ends'), 'notify', set.notifyAfterSec === null ? t('Kapalı', 'Off') : `${set.notifyAfterSec} ${t('sn', 's')}+`, () =>
          changeSettings($, old => ({ ...old, notifyAfterSec: nextNotify(old.notifyAfterSec) })),
        )}
        {toggle(t('Ses', 'Sound'), 'sound', onOff(set.sound), () => flip($, 'sound'))}
        {toggle(t('Özeti sesli oku', 'Read the summary aloud'), 'speak', onOff(set.speakSummary), () => flip($, 'speakSummary'))}
        <Box>
          <Text>{t('Telefona', 'To the phone')} ({channels.join(', ') || t('kanal yok', 'no channel')}): </Text>
          <Button key="remote" label={onOff(set.remoteNotify)} onPress={() => void flip($, 'remoteNotify')} />
          <Button key="remote-test" label="Test" onPress={() => testRemote($, lang)} />
        </Box>
        {gap}
        {heading(`🧠 ${t('Asistan', 'Assistant')}`)}
        {toggle(t('Tur özeti', 'Turn summary'), 'turn-summary', onOff(set.turnSummary), () => flip($, 'turnSummary'))}
        {toggle(t('Terim sözlüğü', 'Glossary'), 'glossary', onOff(set.glossary), () => flip($, 'glossary'))}
        {toggle(t('CLAUDE.md kontrolü', 'CLAUDE.md check'), 'rules-check', onOff(set.rulesCheck), () => flip($, 'rulesCheck'))}
        {toggle(t('Model önerisi', 'Model hint'), 'model-hints', onOff(set.modelHints), () => flip($, 'modelHints'))}
        {toggle(t('Düzenlemeden sonra test', 'Tests after edits'), 'auto-tests', onOff(set.autoTests), () => flip($, 'autoTests'))}
        {toggle(t('Maliyet tahmini', 'Cost estimate'), 'cost-estimate', onOff(set.costEstimate), () => flip($, 'costEstimate'))}
        {gap}
        <Text bold>
          💰 {t('Günlük bütçe', 'Daily budget')}: {set.budgetUsd === null ? t('yok', 'none') : `$${set.budgetUsd}`}
        </Text>
        <Box>
          <Button key="budget-down" label="-5" onPress={() => budgetStep(-5)} />
          <Button key="budget-up" label="+5" onPress={() => budgetStep(5)} />
          <Button key="budget-off" label={t('Kaldır', 'Remove')} onPress={() => changeSettings($, old => ({ ...old, budgetUsd: null }))} />
        </Box>
        <Text bold>
          📁 {t('Proje bütçesi', 'Project budget')}: {projectBudget === null ? t('yok', 'none') : `$${projectBudget}`}
        </Text>
        <Box>
          <Button key="pbudget-down" label="-5" onPress={() => setProjectBudget($, Math.max(1, (projectBudget ?? 0) - 5))} />
          <Button key="pbudget-up" label="+5" onPress={() => setProjectBudget($, (projectBudget ?? 0) + 5)} />
          <Button key="pbudget-off" label={t('Kaldır', 'Remove')} onPress={() => setProjectBudget($, null)} />
        </Box>
        {toggle(t('Bütçe dolunca', 'When spent'), 'budget-mode', set.budgetMode === 'block' ? t('Durdur', 'Stop') : t('Uyar', 'Warn'), () =>
          changeSettings($, old => ({ ...old, budgetMode: old.budgetMode === 'block' ? 'warn' : 'block' })),
        )}
        {gap}
        {heading(`💾 ${t('Taşı', 'Move')}`)}
        <Box>
          <Button key="export" label={t('📤 Dışa aktar', '📤 Export')} onPress={() => exportFromPane($, lang)} />
          <Button key="import" label={t('📥 İçe aktar', '📥 Import')} onPress={() => importFromPane($, lang)} />
        </Box>
        <Text dimColor>~/asistan-ayarlar.json</Text>
      </Box>
    )
  }

  const body =
    current === 'ozet'
      ? await ozet()
      : current === 'prompt'
        ? await prompt()
        : current === 'guvenlik'
          ? await guvenlik()
          : current === 'kod'
            ? await kod()
            : current === 'zaman'
              ? await zaman()
              : current === 'sozluk'
                ? await sozluk()
                : await ayarlar()

  return (
    <Box flexDirection="column">
      {tabBar}
      {gap}
      {body}
    </Box>
  )
}

export async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const label = await read($, busyAtom)
  const warn = await read($, warningAtom)
  const set = await read($, settingsAtom)
  const tests = await read($, testsAtom)
  const estimate = await read($, estimateAtom)
  const t = (tr: string, en: string) => say(set.language, tr, en)

  return (
    <Box flexDirection="column">
      {warn !== null && (
        <Box>
          <Text color="error">{warn} </Text>
          <Button key="dismiss" label={t('Kapat', 'Close')} onPress={() => update($, warningAtom, () => null)} />
        </Box>
      )}
      <Box>
        {label !== null ? (
          <Text color="warning">{label}</Text>
        ) : (
          <Button
            key="improve"
            label={t('✨ İyileştir', '✨ Improve')}
            hotkey="i"
            variant="primary"
            onPress={async () => improveDraft($, (await $.prompt.read()).text)}
          />
        )}
        <Text dimColor>
          {' '}
          {set.improveMode === 'always' ? t('her prompt iyileştirilir', 'every prompt is improved') : t('++ ile başla: otomatik', 'start with ++: automatic')} ·{' '}
        </Text>
        <Button key="panel" label="Panel" hotkey="p" plain onPress={() => void $.ui.open({ id: PANE, title: PANE_TITLE })} />
        {estimate !== null && <Text dimColor> · {estimate}</Text>}
        {tests?.state === 'running' && <Text color="warning"> · 🧪 {t('test çalışıyor', 'tests running')}</Text>}
        {tests?.state === 'fail' && <Text color="error"> · 🧪 {t('testler başarısız', 'tests failed')}</Text>}
      </Box>
    </Box>
  )
}
