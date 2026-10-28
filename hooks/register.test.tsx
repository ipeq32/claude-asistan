import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { codeBlocksIn, gitOps, isSensitivePath, lookalikeOf, maskOutput, parseInstalls } from './lib'

// The kit fills origin, wait and presentation as the engine would.
const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text } as Parameters<Engine['prompt']['submit']>[0])
const run = ($: Engine, command: string, args: string) =>
  $.command.run({ command, args } as Parameters<Engine['command']['run']>[0])
const call = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call(input as Parameters<Engine['tool']['call']>[0])

// Fake keys, put together at run time so no file holds one as written.
const KEY = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-')

const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const PANE_PROPS = {
  title: 'Asistan',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

// What every test needs beneath the plugin: a clock, a store, a folder.
const world = (on: On) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/p' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

test('engelle modunda anahtarlı prompt gönderilmez', async ($, on) => {
  world(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: 'engine' }))

  await run($, 'anahtar-koruma', 'engelle')
  const sent = await submit($, `bu anahtarı kullan ${KEY}`)

  expect(sent.drop).toBeDefined()
})

test('maskele modunda anahtar maskelenir', async ($, on) => {
  world(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: 'engine' }))

  await run($, 'anahtar-koruma', 'maskele')
  const sent = await submit($, `bu anahtarı kullan ${KEY}`)

  expect(sent.text).toBe('bu anahtarı kullan [GİZLİ: OpenAI anahtarı]')
})

test('++ ile başlayan prompt İngilizceye çevrilir, Türkçe yanıt istenir', async ($, on) => {
  world(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '{"en": "Fix the login bug in src/auth.ts.", "tr": "src/auth.ts içindeki giriş hatasını düzelt.", "score": 5, "missing": ["beklenen sonuç"], "added": ["hedef dosya"]}',
      usage: USAGE,
    },
  }))

  const sent = await submit($, '++ src/auth.ts deki login hatasını düzelt')

  expect(sent.text).toBe('Fix the login bug in src/auth.ts.')
  expect(sent.context?.[0]).toContain('Reply to the user in Turkish')
  expect(sent.context?.[0]).toContain('src/auth.ts deki login hatasını düzelt')
})

test('ön eksiz prompt olduğu gibi gider', async ($, on) => {
  world(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const sent = await submit($, 'README dosyasını güncelle lütfen')

  expect(sent.text).toBe('README dosyasını güncelle lütfen')
})

test('panel her yüzeyde çizilir, sekmeler değişir', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'asistan', surface, component: 'Pane', requestId: 'asistan', props: PANE_PROPS })
    expect((await ui.find({ type: 'Text', text: /Verimlilik/ }))?.text).toContain('Verimlilik')
    await ui.press({ key: 'tab-prompt' })
    expect((await ui.find({ type: 'Text', text: /Şablonlar/ }))?.text).toContain('Şablonlar')
    await ui.press({ key: 'tab-guvenlik' })
    expect(await ui.find({ key: 'secret-mode' })).toBeDefined()
    expect(await ui.find({ key: 'package-guard' })).toBeDefined()
    await ui.press({ key: 'tab-kod' })
    expect(await ui.find({ key: 'commit' })).toBeDefined()
    expect(await ui.find({ key: 'tests-run' })).toBeDefined()
    await ui.press({ key: 'tab-sozluk' })
    expect((await ui.find({ type: 'Text', text: /Terimler/ }))?.text).toContain('Terimler')
    await ui.press({ key: 'tab-ayarlar' })
    await ui.press({ key: 'budget-up' })
    expect((await ui.find({ type: 'Text', text: /Günlük bütçe/ }))?.text).not.toContain('yok')
    await ui.press({ key: 'tab-ozet' })
    await ui.unmount()
  }
})

test('hassas dosya yasağı açılınca Read reddedilir', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: {} }))
  const ui = await $.ui.mount({ plugin: 'asistan', surface: 'terminal', component: 'Pane', requestId: 'asistan', props: PANE_PROPS })
  await ui.press({ key: 'tab-guvenlik' })
  await ui.press({ key: 'env-read' })
  await ui.unmount()

  const env = await call($, { tool: 'Read', file_path: '/p/.env' })
  expect(env.deny ?? env.text ?? '').toContain('hassas')
  const ssh = await call($, { tool: 'Read', file_path: '/home/u/.ssh/id_ed25519' })
  expect(ssh.deny ?? ssh.text ?? '').toContain('hassas')
  const example = await call($, { tool: 'Read', file_path: '/p/.env.example' })
  expect(example.deny).toBeUndefined()
})

test('commit kontrolü .env eklenmesini durdurur', async ($, on) => {
  world(on)
  on('fs.read', () => ({ value: 'const a = 1' }))
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    return {
      value: {
        exitCode: 0,
        stdout: argv.includes('--dry-run') ? "add '.env'\nadd 'src/a.ts'\n" : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', () => ({ result: {} }))

  const ran = await call($, { tool: 'Bash', command: 'git add . && git commit -m x' })
  expect(ran.deny ?? ran.text ?? '').toContain('hassas dosya: .env')
})

test('olmayan ya da taklit paket kurulmaz, bilinen paket kurulur', async ($, on) => {
  world(on)
  on('http.fetch', (_, e) => {
    const url = (e as { url: string }).url
    const day = 86400000
    const isPopular = url.endsWith('/react')
    const body = url.includes('downloads')
      ? { downloads: isPopular ? 20000000 : 12 }
      : { time: { created: new Date(Date.now() - (isPopular ? 3000 : 2) * day).toISOString() } }
    const isMissing = url.includes('reakt-dom-utilz')
    return { value: { status: isMissing ? 404 : 200, ok: !isMissing, headers: {}, text: JSON.stringify(body) } }
  })
  on('tool.call', () => ({ result: {} }))

  const missing = await call($, { tool: 'Bash', command: 'npm install reakt-dom-utilz' })
  expect(missing.deny ?? missing.text ?? '').toContain('böyle bir paket yok')
  const squat = await call($, { tool: 'Bash', command: 'npm i expres' })
  expect(squat.deny ?? squat.text ?? '').toContain('express')
  const fine = await call($, { tool: 'Bash', command: 'npm install react' })
  expect(fine.deny).toBeUndefined()
})

test('yardımcılar', () => {
  const env = maskOutput(`     1\tOPENAI_API_KEY=${KEY}\n     2\tDEBUG=true`)
  expect(env.text).not.toContain('abcdefghij')
  expect(env.text).toContain('DEBUG=true')
  expect(maskOutput('const password = process.env.DB_PASSWORD\napiKey: config.apiKey').kinds.length).toBe(0)

  expect(gitOps('cd web && git -C sub add -A && git commit -am "fix"')).toEqual([
    { sub: 'add', args: ['-A'], dir: 'sub' },
    { sub: 'commit', args: ['-am', 'fix'], dir: 'web' },
  ])

  expect(parseInstalls('cd x && npm i -D @types/node lodash@4 ./local && pip install "requests[socks]>=2" -r req.txt')).toEqual([
    { ecosystem: 'npm', names: ['@types/node', 'lodash'] },
    { ecosystem: 'pypi', names: ['requests'] },
  ])
  expect(parseInstalls('npm install')).toEqual([])

  expect(lookalikeOf('pypi', 'reqeusts')).toBe('requests')
  expect(lookalikeOf('npm', 'react')).toBeNull()
  expect(lookalikeOf('npm', 'my-own-lib')).toBeNull()

  expect(isSensitivePath('/home/u/.ssh/id_rsa')).toBe(true)
  expect(isSensitivePath('/home/u/.ssh/id_rsa.pub')).toBe(false)
  expect(isSensitivePath('/p/certs/server.pem')).toBe(true)
  expect(isSensitivePath('/p/src/key.ts')).toBe(false)

  expect(codeBlocksIn('a\n```ts\nconst x = 1\n```\nb\n```\nls\n```')).toEqual([
    { lang: 'ts', text: 'const x = 1' },
    { lang: 'metin', text: 'ls' },
  ])
})

test('değişen dosya oturum başındaki haline geri alınır', async ($, on) => {
  world(on)
  const written: { path: string; text: string }[] = []
  on('fs.read', () => ({ value: 'eski içerik\n' }))
  on('fs.write', (_, e) => {
    written.push(e as { path: string; text: string })
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '--- önce\n+++ şimdi\n@@ -1 +1 @@\n-eski içerik\n+yeni içerik\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('tool.call', () => ({ result: {} }))

  await call($, { tool: 'Edit', file_path: '/p/a.txt', old_string: 'eski', new_string: 'yeni' })

  const ui = await $.ui.mount({ plugin: 'asistan', surface: 'terminal', component: 'Pane', requestId: 'asistan', props: PANE_PROPS })
  await ui.press({ key: 'tab-kod' })
  await ui.press({ key: 'file-/p/a.txt' })
  await ui.press({ key: 'revert-/p/a.txt' })
  await ui.press({ key: 'revert-yes-/p/a.txt' })
  await ui.unmount()

  expect(written).toEqual([{ path: '/p/a.txt', text: 'eski içerik\n' }])
})
