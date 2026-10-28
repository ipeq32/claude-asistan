import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { AsistanSettings, Tab, Template } from '../types'
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
import { MODE_LABEL, NEXT_MODE, bar, cachePctOf, projectOf, short, sparkline, usd } from './lib'
import { DEFAULT_SETTINGS as ATOM_DEFAULT_SETTINGS, EMPTY_METRICS as ATOM_EMPTY_METRICS } from './lib'

// The state this file reads and writes. The scan that lists a mod's state
// takes atoms only from the file that reads them, so register.tsx, actions.ts
// and pane.tsx each declare the atoms they use: keep the copies alike (same
// key, initial value and shape tag in every file). Change a shape tag when that
// value's fields change; it declines what an earlier version stored, which
// outlives a reload.
const settingsAtom = atom({ plugin: 'asistan', key: 'settings' } as const, ATOM_DEFAULT_SETTINGS, { shape: 'settings-2' })
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

const TABS: { id: Tab; label: string; hotkey: string }[] = [
  { id: 'ozet', label: 'Özet', hotkey: '1' },
  { id: 'prompt', label: 'Prompt', hotkey: '2' },
  { id: 'guvenlik', label: 'Güvenlik', hotkey: '3' },
  { id: 'kod', label: 'Kod', hotkey: '4' },
  { id: 'sozluk', label: 'Sözlük', hotkey: '5' },
  { id: 'ayarlar', label: 'Ayarlar', hotkey: '6' },
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

const onOff = (value: boolean) => (value ? 'Açık' : 'Kapalı')

function flip($: EngineInterface, field: Flag) {
  return changeSettings($, old => ({ ...old, [field]: !old[field] }))
}

const nextNotify = (value: number | null) =>
  NOTIFY_STEPS[(NOTIFY_STEPS.indexOf(value) + 1) % NOTIFY_STEPS.length] ?? null

async function saveLastPrompt($: EngineInterface) {
  const last = await read($, lastPromptAtom)
  if (last === null) {
    $.ui.toast('Kaydedilecek prompt yok.')
    return
  }
  const base = last.original.split(/\s+/).slice(0, 3).join(' ').slice(0, 24) || 'şablon'
  await saveTemplates($, list => {
    let name = base
    for (let i = 2; list.some(one => one.name === name); i += 1) name = `${base} ${i}`
    return [...list, { name, text: last.original }].slice(-12)
  })
  $.ui.toast('Şablon kaydedildi.')
}

async function setProjectBudget($: EngineInterface, value: number | null) {
  const project = projectOf(await $.session.cwd())
  await update($, projectBudgetAtom, () => value)
  await $.store.set(`proj-budget:${project}`, value)
}

async function fillHistory($: EngineInterface, text: string) {
  await $.prompt.fill({ text, mode: 'replace' })
  $.ui.toast('Geçmişten kutuya yazıldı.')
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
  const room = Math.max(60, width * 6)

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
          label={one.label}
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
            {heading(`📅 Haftalık rapor (${report.title})`)}
            <Text>
              Toplam {usd(report.totalUsd)} <Text color="suggestion">{sparkline(report.days)}</Text> · {report.turns} tur
            </Text>
            <Text dimColor>
              ort. skor {report.avgScore === null ? '—' : Math.round(report.avgScore)} · ort. prompt kalitesi{' '}
              {report.avgQuality === null ? '—' : report.avgQuality.toFixed(1)}
            </Text>
            {report.projects.slice(0, 3).map(one => (
              <Text dimColor>
                · {one.name} {usd(one.usd)}
              </Text>
            ))}
            <Button key="report-close" label="Kapat" onPress={() => update($, reportAtom, () => null)} />
            {gap}
          </Box>
        )}
        <Text bold>
          📊 Verimlilik <Text color={scoreColor}>{m.score ?? '—'}/100</Text>
        </Text>
        <Text>
          <Text color={scoreColor}>{scoreBar.filled}</Text>
          <Text dimColor>{scoreBar.empty}</Text>
          {trends.score.some(one => one > 0) && <Text dimColor> 14g {sparkline(trends.score)}</Text>}
        </Text>
        <Text dimColor>
          cache {cache === null ? '—' : `%${cache}`} · ctx {m.ctxPct === null ? '—' : `%${Math.round(m.ctxPct)}`} · hata{' '}
          {m.failed}/{m.tools}
        </Text>
        {m.limits.length > 0 && (
          <Text dimColor>limit {m.limits.map(one => `${one.kind} %${Math.round(one.pct)}`).join(' · ')}</Text>
        )}
        {gap}
        {heading('💰 Maliyet')}
        <Text>
          oturum {usd(m.costUsd)} · bugün{' '}
          <Text color={budgetPct === null ? 'text' : budgetPct >= 100 ? 'error' : budgetPct >= 80 ? 'warning' : 'success'}>
            {usd(m.todayUsd)}
            {set.budgetUsd !== null ? ` / $${set.budgetUsd}` : ''}
          </Text>
        </Text>
        <Text dimColor>
          bu proje bugün {usd(m.projectTodayUsd)}
          {projectBudget !== null ? ` / $${projectBudget}` : ''}
        </Text>
        {m.weekDays.length > 0 && (
          <Text>
            7 gün <Text color="suggestion">{sparkline(m.weekDays)}</Text> <Text dimColor>{usd(m.weekUsd)}</Text>
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
              $.ui.toast(result === null ? 'Tur sürerken compact yapılamaz.' : 'Compact başladı.')
            }}
          />
        )}
        {tasks.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading(`📋 Görevler ${done}/${tasks.length}`)}
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
            {heading('🧾 Son tur')}
            <Text>{summary}</Text>
          </Box>
        )}
        {agentRows.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading('🤖 Ajanlar')}
            {agentRows.map(row => (
              <Button
                key={`agent-${row.id}`}
                plain
                onPress={async () => {
                  const viewed = await $.ui.view({ agentId: row.id })
                  if ('deny' in viewed && viewed.deny) $.ui.toast(`Açılamadı: ${viewed.deny}`)
                }}
              >
                {row.label} <Text dimColor>{row.status}</Text>
              </Button>
            ))}
          </Box>
        )}
        {error !== null && (
          <Text color="error" wrap="truncate-end">
            ❌ Son hata: {short(error.command, 40)} (4)
          </Text>
        )}
        {gap}
        {heading('💡 Öneriler')}
        {tipList.length === 0 && <Text dimColor>Şimdilik her şey yolunda.</Text>}
        {tipList.map(tip => (
          <Text color={tip.level === 'error' ? 'error' : tip.level === 'warn' ? 'warning' : 'text'}>• {tip.text}</Text>
        ))}
      </Box>
    )
  }

  const prompt = async () => {
    const last = await read($, lastPromptAtom)
    const list = await read($, templatesAtom)
    const history = await read($, historyAtom)
    const query = (await read($, historyQueryAtom)).toLocaleLowerCase('tr')
    const trends = await read($, trendsAtom)
    const matches = history
      .filter(one => !query || one.text.toLocaleLowerCase('tr').includes(query))
      .slice(-6)
      .reverse()
    return (
      <Box flexDirection="column">
        {toggle('İyileştirme', 'improve-mode', set.improveMode === 'always' ? 'her prompt' : '++ ön eki', () =>
          changeSettings($, old => ({ ...old, improveMode: old.improveMode === 'always' ? 'prefix' : 'always' })),
        )}
        <Button
          key="improve-now"
          label="✨ Kutudakini iyileştir"
          onPress={async () => improveDraft($, (await $.prompt.read()).text)}
        />
        {gap}
        {last === null && <Text dimColor>Henüz iyileştirilmiş prompt yok. ++ ile başla ya da ✨'e bas.</Text>}
        {last !== null && (
          <Box flexDirection="column">
            {last.quality !== null && (
              <Text bold>
                Kalite{' '}
                <Text color={last.quality >= 7 ? 'success' : last.quality >= 4 ? 'warning' : 'error'}>{last.quality}/10</Text>
                {trends.quality.some(one => one > 0) && <Text dimColor> 14g {sparkline(trends.quality)}</Text>}
              </Text>
            )}
            {last.missing.length > 0 && <Text color="warning">Eksik: {last.missing.join(', ')}</Text>}
            {last.added.length > 0 && <Text color="success">Eklenen: {last.added.join(', ')}</Text>}
            <Text dimColor>Yazdığın:</Text>
            <Text>{short(last.original, room)}</Text>
            <Text color="suggestion">Gönderilen (EN){last.isPending ? ' · kutuda bekliyor' : ''}:</Text>
            <Text>{short(last.en, room)}</Text>
            <Text color="success">Türkçesi:</Text>
            <Text>{short(last.tr, room)}</Text>
          </Box>
        )}
        {gap}
        {heading('🕘 Geçmiş')}
        {Input !== null && (
          <Input
            key="history-q"
            placeholder="ara…"
            value={query}
            onInput={(value: string) => void update($, historyQueryAtom, () => value)}
            onSubmit={(value: string) => void update($, historyQueryAtom, () => value)}
          />
        )}
        {matches.length === 0 && <Text dimColor>{history.length ? 'Eşleşme yok.' : 'Henüz geçmiş yok.'}</Text>}
        {matches.map(one => (
          <Button key={`hist-${one.at}`} plain onPress={() => fillHistory($, one.text)}>
            ▸ {short(one.text, Math.max(20, width - 14))} <Text dimColor>{one.project}</Text>
          </Button>
        ))}
        {gap}
        {heading('📚 Şablonlar')}
        {list.length === 0 && <Text dimColor>Kayıtlı şablon yok. /sablon kaydet &lt;ad&gt; &lt;metin&gt;</Text>}
        {list.map((template: Template) => (
          <Button key={`tpl-${template.name}`} plain onPress={() => fillTemplate($, template)}>
            ▸ {template.name} <Text dimColor>{short(template.text, 30)}</Text>
          </Button>
        ))}
        {last !== null && <Button key="save-last" label="💾 Son promptu kaydet" onPress={() => saveLastPrompt($)} />}
      </Box>
    )
  }

  const guvenlik = async () => {
    const s = await read($, envAtom)
    const evs = await read($, eventsAtom)
    const packages = await read($, packagesAtom)
    const network = await read($, networkAtom)
    const problems = s.tracked.length + s.unignored.length
    return (
      <Box flexDirection="column">
        {heading('🔐 .env dosyaları')}
        {!s.isChecked && <Text dimColor>Taranıyor…</Text>}
        {s.isChecked && s.files.length === 0 && <Text dimColor>.env dosyası yok</Text>}
        {s.isChecked && s.files.length > 0 && problems === 0 && (
          <Text color="success">✓ {s.files.length} .env, hepsi git dışında</Text>
        )}
        {s.tracked.map(file => (
          <Text color="error">❌ git'te: {file}</Text>
        ))}
        {s.unignored.map(file => (
          <Text color="warning">⚠ ignore değil: {file}</Text>
        ))}
        <Button key="rescan" label="🔄 Yeniden tara" onPress={async () => scanEnv($, await $.session.cwd())} />
        {gap}
        {heading('🛡 Korumalar')}
        {toggle('Promptta anahtar', 'secret-mode', MODE_LABEL[set.secretMode], () =>
          changeSettings($, old => ({ ...old, secretMode: NEXT_MODE[old.secretMode] })),
        )}
        {toggle('Araç çıktısını maskele', 'mask-output', onOff(set.maskToolOutput), () => flip($, 'maskToolOutput'))}
        {toggle('Commit kontrolü', 'commit-guard', onOff(set.commitGuard), () => flip($, 'commitGuard'))}
        {toggle('Hassas dosya okuma', 'env-read', set.blockEnvRead ? 'Yasak' : 'Serbest', () => flip($, 'blockEnvRead'))}
        {toggle('Paket kontrolü', 'package-guard', onOff(set.packageGuard), () => flip($, 'packageGuard'))}
        {toggle('Ağ izleme', 'network-watch', onOff(set.networkWatch), () => flip($, 'networkWatch'))}
        {packages.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading('📦 Paketler')}
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
            {heading('🌐 Ağ')}
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
        {heading('📜 Olaylar')}
        {evs.length === 0 && <Text dimColor>Olay yok.</Text>}
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
        {heading(`📂 Değişen dosyalar (${files.length})`)}
        {files.length === 0 && <Text dimColor>Bu oturumda düzenlenen dosya yok.</Text>}
        {files
          .slice()
          .reverse()
          .map(file => (
            <Box flexDirection="column">
              <Button key={`file-${file.path}`} plain onPress={() => showDiff($, file.path)}>
                {diff?.path === file.path ? '▾' : '▸'} {short(rel(file.path), Math.max(20, width - 12))}{' '}
                <Text dimColor>{file.isNew ? 'yeni' : `×${file.edits}`}</Text>
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
                      <Text color="warning">{file.isNew ? 'Dosya silinsin mi? ' : 'Oturum başındaki haline dönsün mü? '}</Text>
                      <Button key={`revert-yes-${file.path}`} label="Evet" variant="primary" onPress={() => revertFile($, file.path)} />
                      <Button key={`revert-no-${file.path}`} label="Vazgeç" onPress={() => update($, confirmRevertAtom, () => null)} />
                    </Box>
                  ) : (
                    file.hasSnapshot && (
                      <Button
                        key={`revert-${file.path}`}
                        label={file.isNew ? '🗑 Sil' : '↩ Geri al'}
                        onPress={() => update($, confirmRevertAtom, () => file.path)}
                      />
                    )
                  )}
                </Box>
              )}
            </Box>
          ))}
        {gap}
        {heading('🧪 Testler')}
        {tests === null && <Text dimColor>Henüz çalıştırılmadı.</Text>}
        {tests !== null && (
          <Text
            color={tests.state === 'pass' ? 'success' : tests.state === 'fail' ? 'error' : tests.state === 'running' ? 'warning' : 'subtle'}
          >
            {tests.state === 'pass' ? '✓' : tests.state === 'fail' ? '✗' : tests.state === 'running' ? '⏳' : '·'} {tests.summary}
          </Text>
        )}
        {tests !== null && tests.command !== '' && <Text dimColor>$ {tests.command}</Text>}
        {tests?.state === 'fail' && <Text dimColor>{tests.output.split('\n').slice(-8).join('\n')}</Text>}
        <Box>
          <Button key="tests-run" label="▶ Çalıştır" onPress={() => runTests($)} />
          {tests?.state === 'fail' && <Button key="tests-send" label="Claude'a gönder" onPress={() => sendTestsToClaude($)} />}
        </Box>
        {gap}
        {heading('❌ Son hata')}
        {error === null && <Text dimColor>Bu oturumda başarısız komut yok.</Text>}
        {error !== null && (
          <Box flexDirection="column">
            <Text color="error" wrap="truncate-end">
              $ {error.command}
            </Text>
            <Text dimColor>{error.output.split('\n').slice(-6).join('\n')}</Text>
            {error.explanation === null ? (
              <Button key="explain" label="🇹🇷 Türkçe açıkla" onPress={() => explainError($)} />
            ) : (
              <Text>{error.explanation}</Text>
            )}
          </Box>
        )}
        {gap}
        {heading('📝 Commit')}
        <Button key="commit" label="Commit mesajı öner" onPress={() => suggestCommit($)} />
        {suggestion !== null && <Text dimColor>{suggestion}</Text>}
        {blocks.length > 0 && (
          <Box flexDirection="column">
            {gap}
            {heading('📋 Son cevaptaki kodlar')}
            {blocks.map((block, i) => (
              <Button key={`copy-${i}`} plain onPress={press => copyBlock($, block, press.surface)}>
                ⧉ <Text color="suggestion">{block.lang}</Text> {short(block.text.split('\n')[0] ?? '', Math.max(16, width - 16))}{' '}
                <Text dimColor>{block.text.split('\n').length} satır</Text>
              </Button>
            ))}
          </Box>
        )}
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
        {heading(`📖 Terimler (${terms.length})`)}
        {Input !== null && (
          <Input
            key="gloss-q"
            placeholder="ara…"
            value={query}
            onInput={(value: string) => void update($, glossaryQueryAtom, () => value)}
            onSubmit={(value: string) => void update($, glossaryQueryAtom, () => value)}
          />
        )}
        {terms.length === 0 && <Text dimColor>Cevaplarda geçen İngilizce terimler burada toplanacak.</Text>}
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
    const budgetStep = (delta: number) =>
      changeSettings($, (old: AsistanSettings) => ({ ...old, budgetUsd: Math.max(1, (old.budgetUsd ?? 0) + delta) }))
    return (
      <Box flexDirection="column">
        {heading('🔔 Bildirim')}
        {toggle('Uzun tur bitince', 'notify', set.notifyAfterSec === null ? 'Kapalı' : `${set.notifyAfterSec} sn+`, () =>
          changeSettings($, old => ({ ...old, notifyAfterSec: nextNotify(old.notifyAfterSec) })),
        )}
        {toggle('Ses', 'sound', onOff(set.sound), () => flip($, 'sound'))}
        {toggle('Özeti sesli oku', 'speak', onOff(set.speakSummary), () => flip($, 'speakSummary'))}
        {gap}
        {heading('🧠 Asistan')}
        {toggle('Tur özeti', 'turn-summary', onOff(set.turnSummary), () => flip($, 'turnSummary'))}
        {toggle('Terim sözlüğü', 'glossary', onOff(set.glossary), () => flip($, 'glossary'))}
        {toggle('Model önerisi', 'model-hints', onOff(set.modelHints), () => flip($, 'modelHints'))}
        {toggle('Düzenlemeden sonra test', 'auto-tests', onOff(set.autoTests), () => flip($, 'autoTests'))}
        {gap}
        <Text bold>💰 Günlük bütçe: {set.budgetUsd === null ? 'yok' : `$${set.budgetUsd}`}</Text>
        <Box>
          <Button key="budget-down" label="-5" onPress={() => budgetStep(-5)} />
          <Button key="budget-up" label="+5" onPress={() => budgetStep(5)} />
          <Button key="budget-off" label="Kaldır" onPress={() => changeSettings($, old => ({ ...old, budgetUsd: null }))} />
        </Box>
        <Text bold>📁 Proje bütçesi: {projectBudget === null ? 'yok' : `$${projectBudget}`}</Text>
        <Box>
          <Button key="pbudget-down" label="-5" onPress={() => setProjectBudget($, Math.max(1, (projectBudget ?? 0) - 5))} />
          <Button key="pbudget-up" label="+5" onPress={() => setProjectBudget($, (projectBudget ?? 0) + 5)} />
          <Button key="pbudget-off" label="Kaldır" onPress={() => setProjectBudget($, null)} />
        </Box>
        {toggle('Bütçe dolunca', 'budget-mode', set.budgetMode === 'block' ? 'Durdur' : 'Uyar', () =>
          changeSettings($, old => ({ ...old, budgetMode: old.budgetMode === 'block' ? 'warn' : 'block' })),
        )}
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

  return (
    <Box flexDirection="column">
      {warn !== null && (
        <Box>
          <Text color="error">{warn} </Text>
          <Button key="dismiss" label="Kapat" onPress={() => update($, warningAtom, () => null)} />
        </Box>
      )}
      <Box>
        {label !== null ? (
          <Text color="warning">{label}</Text>
        ) : (
          <Button
            key="improve"
            label="✨ İyileştir"
            hotkey="i"
            variant="primary"
            onPress={async () => improveDraft($, (await $.prompt.read()).text)}
          />
        )}
        <Text dimColor> {set.improveMode === 'always' ? 'her prompt iyileştirilir' : '++ ile başla: otomatik'} · </Text>
        <Button key="panel" label="Panel" hotkey="p" plain onPress={() => void $.ui.open({ id: PANE, title: PANE_TITLE })} />
        {tests?.state === 'running' && <Text color="warning"> · 🧪 test çalışıyor</Text>}
        {tests?.state === 'fail' && <Text color="error"> · 🧪 testler başarısız</Text>}
      </Box>
    </Box>
  )
}
