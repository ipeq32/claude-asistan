export type SecretMode = 'warn' | 'mask' | 'block'
export type ImproveMode = 'prefix' | 'always'
export type BudgetMode = 'warn' | 'block'
export type Tab = 'ozet' | 'prompt' | 'guvenlik' | 'kod' | 'zaman' | 'sozluk' | 'ayarlar'
export type Lang = 'tr' | 'en'
export type ModelProvider = 'haiku' | 'ollama'

export type AsistanSettings = {
  secretMode: SecretMode
  improveMode: ImproveMode
  maskToolOutput: boolean
  commitGuard: boolean
  // Keeps the agent away from .env files, keys and credentials.
  blockEnvRead: boolean
  packageGuard: boolean
  networkWatch: boolean
  budgetUsd: number | null
  budgetMode: BudgetMode
  // A turn at least this long raises a desktop notification; null: none.
  notifyAfterSec: number | null
  sound: boolean
  speakSummary: boolean
  turnSummary: boolean
  glossary: boolean
  modelHints: boolean
  autoTests: boolean
  language: Lang
  // Where the mod's own model calls go: Haiku, or a local Ollama model whose
  // calls never leave the machine.
  modelProvider: ModelProvider
  ollamaModel: string | null
  // Long turns and limit warnings also go to Telegram or Discord.
  remoteNotify: boolean
  // After each turn, compare what was done with the project's CLAUDE.md.
  rulesCheck: boolean
  costEstimate: boolean
}

export type PromptRecord = {
  original: string
  en: string
  tr: string
  // How clear the original request was, 0-10, what it lacked, and what the
  // rewrite made explicit.
  quality: number | null
  missing: string[]
  added: string[]
  // Filled into the box and not sent yet: the submit that sends it unchanged
  // is not improved twice.
  isPending: boolean
  at: number
}

export type Tip = { id: string; text: string; level: 'info' | 'warn' | 'error' }

export type Limit = { kind: string; pct: number }

export type ProjectCost = { name: string; usd: number }

export type Metrics = {
  turns: number
  tools: number
  failed: number
  denied: number
  inputTokens: number
  cacheRead: number
  cacheWrite: number
  ctxPct: number | null
  costUsd: number | null
  todayUsd: number | null
  weekUsd: number | null
  // The last seven days' spend, oldest first.
  weekDays: number[]
  projectTodayUsd: number | null
  // This week's spend per project, the largest first.
  projects: ProjectCost[]
  limits: Limit[]
  score: number | null
}

// Daily averages over the last 14 days, oldest first; 0 where none.
export type Trends = { quality: number[]; score: number[] }

export type WeeklyReport = {
  title: string
  totalUsd: number
  days: number[]
  projects: ProjectCost[]
  avgScore: number | null
  avgQuality: number | null
  turns: number
}

export type EnvStatus = {
  isChecked: boolean
  files: string[]
  tracked: string[]
  unignored: string[]
}

export type SecurityEvent = { text: string; at: number }

export type LastError = {
  command: string
  output: string
  explanation: string | null
  at: number
}

export type AgentRow = { id: string; label: string; status: string }

export type Template = { name: string; text: string }

export type HistoryItem = { text: string; project: string; at: number }

export type ChangedFile = {
  path: string
  edits: number
  // Absent before this session's first edit of it.
  isNew: boolean
  // This session holds the content from before its first edit.
  hasSnapshot: boolean
}

export type DiffView = { path: string; text: string }

export type TestStatus = {
  state: 'running' | 'pass' | 'fail' | 'none'
  command: string
  summary: string
  output: string
  at: number
}

export type TaskRow = { id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }

export type CodeBlock = { lang: string; text: string }

export type NetRow = { domain: string; count: number; isKnown: boolean }

export type PackageCheck = {
  name: string
  ecosystem: 'npm' | 'pypi'
  verdict: 'ok' | 'warn' | 'block'
  note: string
}

export type Term = { term: string; tr: string }

export type TimelineRow = { id: string; tool: string; label: string; ms: number; isOk: boolean; at: number }

export type TurnStat = { turn: number; label: string; tokens: number; usd: number; ms: number }

export type VulnRow = { name: string; version: string; ids: string[] }

export type VulnScan = { state: 'running' | 'done'; checked: number; rows: VulnRow[]; note: string }

export type HistoryScan = {
  state: 'running' | 'done'
  commits: number
  hits: { sha: string; file: string; kind: string }[]
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    asistan: {
      settings: Shaped<AsistanSettings>
      lastPrompt: Shaped<PromptRecord | null>
      tips: Shaped<Tip[]>
      metrics: Shaped<Metrics>
      trends: Shaped<Trends>
      report: Shaped<WeeklyReport | null>
      env: Shaped<EnvStatus>
      events: Shaped<SecurityEvent[]>
      lastError: Shaped<LastError | null>
      agents: Shaped<AgentRow[]>
      templates: Shaped<Template[]>
      history: Shaped<HistoryItem[]>
      changedFiles: Shaped<ChangedFile[]>
      diffView: Shaped<DiffView | null>
      tests: Shaped<TestStatus | null>
      tasks: Shaped<TaskRow[]>
      codeBlocks: Shaped<CodeBlock[]>
      network: Shaped<NetRow[]>
      packages: Shaped<PackageCheck[]>
      glossary: Shaped<Term[]>
      timeline: Shaped<TimelineRow[]>
      turnStats: Shaped<TurnStat[]>
      vulnScan: Shaped<VulnScan | null>
      historyScan: Shaped<HistoryScan | null>
      teamTemplates: Shaped<Template[]>
      rules: string | null
      estimate: string | null
      warning: string | null
      busy: string | null
      tab: Tab
      turnSummary: string | null
      commitSuggestion: string | null
      historyQuery: string
      glossaryQuery: string
      confirmRevert: string | null
      projectBudget: number | null
    }
  }
}
