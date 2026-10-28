// Pure helpers: nothing here reaches `$`.
import type { AsistanSettings, CodeBlock, Lang, Metrics, SecretMode } from '../types'

// ---- language -------------------------------------------------------------------

export const say = (lang: Lang, tr: string, en: string) => (lang === 'en' ? en : tr)

export const langName = (lang: Lang) => (lang === 'en' ? 'English' : 'Turkish')

// ---- secrets ------------------------------------------------------------------

// `isStrict` patterns are specific enough to mask in what tools return
// (source code, logs) without breaking it; the rest only judge prompts.
const SECRET_PATTERNS: { kind: string; re: RegExp; isStrict: boolean }[] = [
  { kind: 'Anthropic anahtarı', re: /sk-ant-[A-Za-z0-9_-]{20,}/g, isStrict: true },
  { kind: 'OpenAI anahtarı', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, isStrict: true },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g, isStrict: true },
  { kind: 'AWS anahtarı', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, isStrict: true },
  { kind: 'Google API anahtarı', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, isStrict: true },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, isStrict: true },
  { kind: 'Stripe anahtarı', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g, isStrict: true },
  {
    kind: 'özel anahtar',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    isStrict: true,
  },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, isStrict: false },
  {
    kind: 'parola/anahtar ataması',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|parola|şifre)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{12,}/gi,
    isStrict: false,
  },
]

// An env-style assignment whose name says it holds a secret, as a .env file
// or `env` prints it; a leading line number (Read's `   12→`) is allowed.
const ENV_SECRET_LINE =
  /^(\s*(?:\d+[\t→│|:]\s*)?(?:export\s+)?[A-Z_][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIALS?|AUTH|DSN|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*\s*=\s*)(['"]?)([^\s'"#]{6,})\2/gm

const patternsFor = (isStrictOnly: boolean) =>
  SECRET_PATTERNS.filter(one => one.isStrict || !isStrictOnly)

export const findSecrets = (text: string, isStrictOnly = false): string[] => {
  const kinds = new Set<string>()
  for (const { kind, re } of patternsFor(isStrictOnly)) {
    re.lastIndex = 0
    if (re.test(text)) kinds.add(kind)
  }
  // An Anthropic key also reads as an OpenAI one.
  if (kinds.has('Anthropic anahtarı')) kinds.delete('OpenAI anahtarı')
  return [...kinds]
}

export const maskSecrets = (text: string, isStrictOnly = false): string =>
  patternsFor(isStrictOnly).reduce(
    (out, { kind, re }) => out.replace(re, `[GİZLİ: ${kind}]`),
    text,
  )

// Masks what a tool handed back: the strict patterns and env-style secret
// assignments. Answers the kinds it masked.
export const maskOutput = (text: string): { text: string; kinds: string[] } => {
  const kinds = findSecrets(text, true)
  ENV_SECRET_LINE.lastIndex = 0
  if (ENV_SECRET_LINE.test(text)) kinds.push('.env değeri')
  if (kinds.length === 0) return { text, kinds }
  const masked = maskSecrets(text, true).replace(ENV_SECRET_LINE, '$1$2[GİZLİ]$2')
  return { text: masked, kinds }
}

// Where in `text` a secret stands, merged and in order: what the prompt box
// paints while it is typed.
export const secretRanges = (text: string): [number, number][] => {
  const ranges: [number, number][] = []
  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      ranges.push([m.index, m.index + m[0].length])
      if (m[0].length === 0) re.lastIndex += 1
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

export const MODE_LABEL: Record<Lang, Record<SecretMode, string>> = {
  tr: { warn: 'Uyar', mask: 'Maskele', block: 'Engelle' },
  en: { warn: 'Warn', mask: 'Mask', block: 'Block' },
}
export const NEXT_MODE: Record<SecretMode, SecretMode> = { warn: 'mask', mask: 'block', block: 'warn' }

export const ENV_NAME = /^\.env(\.[\w.-]+)?$/
export const ENV_EXAMPLE = /\.(example|sample|template|dist|defaults)$/
export const ENV_PATH = /(^|\/)\.env(\.[\w.-]+)?$/
export const ENV_IN_COMMAND = /(^|[\s/'"=])\.env(\.[\w-]+)?(\s|$|['"])/

export const isEnvPath = (path: string) => ENV_PATH.test(path) && !ENV_EXAMPLE.test(path)

// Files that hold keys or credentials beside .env: SSH keys, certificates,
// cloud and registry credentials. A public key (.pub) is not one.
const SENSITIVE_PATHS = [
  /(^|\/)\.ssh\/(?!.*\.pub$)(?!known_hosts$)(?!config$)/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /\.(pem|key|p12|pfx|keystore|jks)$/,
  /(^|\/)\.aws\/(credentials|config)$/,
  /(^|\/)(\.kube\/config|kubeconfig)$/,
  /(^|\/)\.(npmrc|pypirc|netrc|pgpass|git-credentials)$/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)credentials\.json$/,
  /service[-_]?account[^/]*\.json$/i,
]

export const isSensitivePath = (path: string) => isEnvPath(path) || SENSITIVE_PATHS.some(re => re.test(path))

export const SENSITIVE_IN_COMMAND =
  /(^|[\s/'"=])\.env(\.[\w-]+)?(\s|$|['"])|\.ssh\/id_|\bid_(rsa|ed25519|ecdsa)\b(?!\.pub)|\.aws\/credentials|\.git-credentials|\.netrc\b|\.pem\b/

export const RISKY: { label: string; re: RegExp }[] = [
  { label: 'rm -rf', re: /\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\b/ },
  { label: 'git push --force', re: /\bgit\s+push\b.*(?:--force\b|\s-f\b)/ },
  { label: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/ },
  { label: 'git clean -f', re: /\bgit\s+clean\s+-[a-zA-Z]*f/ },
  { label: 'chmod 777', re: /\bchmod\s+(?:-R\s+)?777\b/ },
  { label: 'internetten script çalıştırma', re: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
  { label: 'DROP TABLE/DATABASE', re: /\bdrop\s+(?:table|database)\b/i },
  { label: 'disk biçimlendirme', re: /\b(?:mkfs(?:\.\w+)?|dd\s+if=)/ },
]

// ---- shell --------------------------------------------------------------------

export const shellWords = (text: string): string[] =>
  (text.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(word => word.replace(/^(['"])([\s\S]*)\1$/, '$2'))

export const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export type GitOp = { sub: 'add' | 'commit' | 'push'; args: string[]; dir: string | undefined }

// The `git add`, `git commit` and `git push` a command line runs, each with the folder
// it runs in as far as a `cd` or `-C` before it says.
export const gitOps = (command: string): GitOp[] => {
  let dir: string | undefined
  const ops: GitOp[] = []
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const words = shellWords(segment.trim())
    if (words[0] === 'cd' && words[1] !== undefined) {
      dir = words[1]
      continue
    }
    const at = words.indexOf('git')
    if (at < 0) continue
    let segmentDir = dir
    let i = at + 1
    while (i < words.length && (words[i] ?? '').startsWith('-')) {
      const flag = words[i]
      if (flag === '-C') segmentDir = words[i + 1]
      i += flag === '-C' || flag === '-c' ? 2 : 1
    }
    const sub = words[i]
    if (sub === 'add' || sub === 'commit' || sub === 'push') ops.push({ sub, args: words.slice(i + 1), dir: segmentDir })
  }
  return ops
}

export const resolveDir = (cwd: string, dir: string | undefined) =>
  dir === undefined || dir.startsWith('~') ? cwd : dir.startsWith('/') ? dir : `${cwd}/${dir}`

export const isCommitAll = (args: string[]) =>
  args.some(arg => arg === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(arg))

// The lines a unified diff adds, without the `+`.
export const addedLines = (diff: string) =>
  diff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n')

// ---- prompts --------------------------------------------------------------------

const ACKS = /^(evet|hayır|tamam|ok|okay|devam|olur|yes|no|go|peki|aynen|tşk|teşekkürler|sağol|y|n)\b/i

export const isVague = (text: string) => {
  const t = text.trim()
  const words = t.split(/\s+/).length
  return t.length >= 6 && words <= 4 && !/[/.`#@:]/.test(t) && !ACKS.test(t)
}

export type Improved = { en: string; tr: string; quality: number | null; missing: string[]; added: string[] }

export const parseJson = (raw: string): Record<string, unknown> | null => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const parseImproved = (raw: string): Improved | null => {
  const value = parseJson(raw)
  if (value === null) return null
  const { en, tr, score, missing } = value
  if (typeof en !== 'string' || !en.trim() || typeof tr !== 'string') return null
  return {
    en: en.trim(),
    tr: tr.trim(),
    quality: typeof score === 'number' ? Math.max(0, Math.min(10, Math.round(score))) : null,
    missing: strings(missing),
    added: strings(value.added),
  }
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').slice(0, 5) : []

export const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ---- metrics ----------------------------------------------------------------------

export const DAY_MS = 86400000

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `cost-day:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const cachePctOf = (m: Metrics) => {
  const total = m.inputTokens + m.cacheRead + m.cacheWrite
  return total > 0 ? Math.round((m.cacheRead / total) * 100) : null
}

export const scoreOf = (m: Metrics) => {
  let score = 100
  const totalIn = m.inputTokens + m.cacheRead + m.cacheWrite
  if (totalIn > 20000) {
    const cache = m.cacheRead / totalIn
    if (cache < 0.5) score -= 20
    else if (cache < 0.75) score -= 10
  }
  if (m.ctxPct !== null) {
    if (m.ctxPct >= 90) score -= 25
    else if (m.ctxPct >= 80) score -= 15
    else if (m.ctxPct >= 60) score -= 5
  }
  if (m.tools >= 5) {
    const failRate = m.failed / m.tools
    if (failRate > 0.3) score -= 20
    else if (failRate > 0.15) score -= 10
  }
  if (m.denied > 3) score -= 5
  if (m.costUsd !== null && m.turns > 0 && m.costUsd / m.turns > 2) score -= 10
  return Math.max(0, Math.min(100, score))
}

const BARS = '▁▂▃▄▅▆▇█'

export const sparkline = (values: number[]) => {
  const max = Math.max(0, ...values)
  return values.map(v => (max <= 0 ? BARS.charAt(0) : BARS.charAt(Math.round((v / max) * 7)))).join('')
}

export const bar = (pct: number, width: number) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}

export const usd = (value: number | null) => (value === null ? '—' : `$${value.toFixed(2)}`)

export const DEFAULT_SETTINGS: AsistanSettings = {
  secretMode: 'warn',
  improveMode: 'prefix',
  maskToolOutput: true,
  commitGuard: true,
  blockEnvRead: false,
  packageGuard: true,
  networkWatch: true,
  budgetUsd: null,
  budgetMode: 'warn',
  notifyAfterSec: 60,
  sound: true,
  speakSummary: false,
  turnSummary: true,
  glossary: true,
  modelHints: true,
  autoTests: true,
  language: 'tr',
  modelProvider: 'haiku',
  ollamaModel: null,
  remoteNotify: false,
  rulesCheck: true,
  costEstimate: true,
}

export const EMPTY_METRICS: Metrics = {
  turns: 0,
  tools: 0,
  failed: 0,
  denied: 0,
  inputTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ctxPct: null,
  costUsd: null,
  todayUsd: null,
  weekUsd: null,
  weekDays: [],
  projectTodayUsd: null,
  projects: [],
  limits: [],
  score: null,
}

export const average = (entry: unknown) => {
  if (typeof entry !== 'object' || entry === null) return 0
  const { sum, n } = entry as { sum?: unknown; n?: unknown }
  return typeof sum === 'number' && typeof n === 'number' && n > 0 ? sum / n : 0
}

export const projectOf = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd

// ---- packages ----------------------------------------------------------------------

export type Pkg = { name: string; version: string | null }
export type Install = { ecosystem: 'npm' | 'pypi'; names: string[]; packages: Pkg[] }

const NPM_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const NPM_VERBS = new Set(['install', 'i', 'in', 'add'])
const PIP_VALUE_FLAGS = new Set(['-r', '-e', '-c', '-i', '-t', '--requirement', '--editable', '--constraint', '--index-url', '--extra-index-url', '--target', '--prefix', '--python'])

const npmName = (spec: string) => {
  if (/^(\.|\/|~|file:|git|https?:|link:|workspace:)/.test(spec)) return null
  if (!spec.startsWith('@') && spec.includes('/')) return null
  return spec.replace(/(.)@[^/]*$/, '$1')
}

const pypiName = (spec: string) => {
  if (/^(\.|\/|~|git\+|https?:)/.test(spec) || spec.endsWith('.whl') || spec.endsWith('.tar.gz')) return null
  const name = spec.replace(/\[.*\]/, '').split(/[=<>!~;@ ]/)[0] ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null
}

// The registry packages a command line installs by name.
export const parseInstalls = (command: string): Install[] => {
  const found: Install[] = []
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    let words = shellWords(segment.trim())
    while (words[0] !== undefined && /^\w+=/.test(words[0])) words = words.slice(1)
    if (words[0] === 'sudo') words = words.slice(1)
    const [tool = '', verb = ''] = words
    if (NPM_MANAGERS.has(tool) && NPM_VERBS.has(verb)) {
      const packages = words
        .slice(2)
        .filter(w => !w.startsWith('-'))
        .map(spec => ({ name: npmName(spec), version: /^@?[^@]+@(\d[\w.+-]*)$/.exec(spec)?.[1] ?? null }))
        .filter((one): one is Pkg => one.name !== null)
      if (packages.length) found.push({ ecosystem: 'npm', names: packages.map(one => one.name), packages })
      continue
    }
    let rest: string[] | null = null
    if ((tool === 'pip' || tool === 'pip3') && verb === 'install') rest = words.slice(2)
    else if (/^python3?$/.test(tool) && verb === '-m' && words[2] === 'pip' && words[3] === 'install') rest = words.slice(4)
    else if (tool === 'uv' && verb === 'pip' && words[2] === 'install') rest = words.slice(3)
    else if ((tool === 'uv' || tool === 'poetry' || tool === 'pipenv') && (verb === 'add' || verb === 'install')) rest = words.slice(2)
    if (rest === null) continue
    const packages: Pkg[] = []
    for (let i = 0; i < rest.length; i += 1) {
      const word = rest[i] ?? ''
      if (PIP_VALUE_FLAGS.has(word)) {
        i += 1
        continue
      }
      if (word.startsWith('-')) continue
      const name = pypiName(word)
      if (name !== null) packages.push({ name, version: /==\s*([\w.+-]+)/.exec(word)?.[1] ?? null })
    }
    if (packages.length) found.push({ ecosystem: 'pypi', names: packages.map(one => one.name), packages })
  }
  return found
}

const POPULAR: Record<'npm' | 'pypi', string[]> = {
  npm: [
    'react', 'react-dom', 'lodash', 'express', 'axios', 'chalk', 'commander', 'debug', 'moment', 'request',
    'typescript', 'webpack', 'vue', 'next', 'jquery', 'eslint', 'prettier', 'jest', 'mocha', 'uuid', 'dotenv',
    'yargs', 'glob', 'rimraf', 'fs-extra', 'body-parser', 'cors', 'mongoose', 'async', 'bluebird', 'underscore',
    'socket.io', 'redux', 'classnames', 'prop-types', 'tslib', 'rxjs', 'zod', 'vite', 'tailwindcss', 'nodemon',
    'dayjs', 'cheerio', 'puppeteer', 'sharp', 'bcrypt', 'jsonwebtoken', 'pg', 'mysql2', 'redis', 'ws', 'semver',
    'minimist', 'inquirer', 'ora', 'colors', 'electron', 'prisma', 'svelte', 'angular', 'nuxt', 'vitest',
    'playwright', 'openai', 'stripe', 'firebase', 'graphql', 'apollo-server', 'knex', 'sequelize', 'passport',
  ],
  pypi: [
    'requests', 'numpy', 'pandas', 'django', 'flask', 'fastapi', 'urllib3', 'setuptools', 'boto3', 'pyyaml',
    'scipy', 'matplotlib', 'pillow', 'beautifulsoup4', 'selenium', 'pytest', 'sqlalchemy', 'cryptography',
    'jinja2', 'click', 'tensorflow', 'torch', 'scikit-learn', 'opencv-python', 'pydantic', 'httpx', 'aiohttp',
    'uvicorn', 'openai', 'anthropic', 'python-dateutil', 'six', 'certifi', 'idna', 'colorama', 'tqdm', 'rich',
    'psycopg2', 'redis', 'celery', 'lxml', 'pymongo', 'paramiko', 'transformers', 'keras', 'seaborn', 'plotly',
    'streamlit', 'gunicorn', 'black', 'flake8', 'mypy', 'poetry', 'virtualenv', 'pip', 'wheel', 'docker',
  ],
}

export const distance = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length] ?? 0
}

// The popular package `name` is one or two edits away from, if it is not
// that package itself: the shape of a typosquat.
export const lookalikeOf = (ecosystem: 'npm' | 'pypi', name: string) => {
  const lower = name.toLowerCase().replace(/_/g, '-')
  const list = POPULAR[ecosystem]
  if (lower.length < 4 || list.includes(lower)) return null
  return list.find(one => Math.abs(one.length - lower.length) <= 2 && distance(one, lower) <= (one.length > 6 ? 2 : 1)) ?? null
}

// ---- network ------------------------------------------------------------------------

const KNOWN_DOMAINS = [
  'github.com', 'githubusercontent.com', 'npmjs.org', 'npmjs.com', 'pypi.org', 'pythonhosted.org',
  'anthropic.com', 'claude.ai', 'claude.com', 'google.com', 'googleapis.com', 'vercel.com', 'vercel.app',
  'stackoverflow.com', 'mozilla.org', 'nodejs.org', 'python.org', 'docker.com', 'docker.io', 'cloudflare.com',
  'jsdelivr.net', 'unpkg.com', 'localhost', '127.0.0.1', 'example.com', 'wikipedia.org', 'microsoft.com',
]

export const urlsIn = (text: string) => text.match(/https?:\/\/[^\s'"<>()]+/g) ?? []

export const domainOf = (url: string) => /^https?:\/\/(?:[^@/]*@)?([^/:?#]+)/.exec(url)?.[1]?.toLowerCase() ?? null

export const isKnownDomain = (domain: string) =>
  KNOWN_DOMAINS.some(known => domain === known || domain.endsWith(`.${known}`))

// ---- answers ------------------------------------------------------------------------

export const codeBlocksIn = (text: string): CodeBlock[] => {
  const blocks: CodeBlock[] = []
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const body = (m[2] ?? '').replace(/\n$/, '')
    if (body.trim()) blocks.push({ lang: m[1] || 'metin', text: body })
  }
  return blocks
}


// ---- dependencies ---------------------------------------------------------------------

// The exact versions a package-lock.json pins.
export const npmLockPackages = (text: string): Pkg[] => {
  const packages = parseJson(text)?.packages
  if (typeof packages !== 'object' || packages === null) return []
  const seen = new Map<string, Pkg>()
  for (const [path, info] of Object.entries(packages as Record<string, unknown>)) {
    const at = path.lastIndexOf('node_modules/')
    if (at < 0) continue
    const version = (info as { version?: unknown } | null)?.version
    const name = path.slice(at + 'node_modules/'.length)
    if (typeof version === 'string') seen.set(`${name}@${version}`, { name, version })
  }
  return [...seen.values()]
}

// The `name==version` pins of a requirements file.
export const requirementPins = (text: string): Pkg[] =>
  text
    .split('\n')
    .map(line => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([\w.+-]+)/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ name: m[1] ?? '', version: m[2] ?? null }))

// ---- history scan ---------------------------------------------------------------------

export type HistoryHit = { sha: string; file: string; kind: string }

// Reads `git log -p --format='commit %H'` line by line: the commit and file
// each added line belongs to, and the keys and sensitive files it adds.
export const historyReader = () => {
  let sha = ''
  let file = ''
  const hits: HistoryHit[] = []
  const seen = new Set<string>()
  let commits = 0
  const hit = (kind: string) => {
    const key = `${sha}|${file}|${kind}`
    if (seen.has(key) || hits.length >= 50) return
    seen.add(key)
    hits.push({ sha: sha.slice(0, 8), file, kind })
  }
  return {
    line(text: string) {
      if (text.startsWith('commit ')) {
        sha = text.slice(7).trim()
        commits += 1
      } else if (text.startsWith('+++ ')) {
        file = text.slice(4).replace(/^b\//, '')
        if (file !== '/dev/null' && isSensitivePath(file)) hit('hassas dosya')
      } else if (text.startsWith('+')) {
        for (const kind of findSecrets(text.slice(1), true)) hit(kind)
      }
    },
    result: () => ({ hits, commits }),
  }
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5)
