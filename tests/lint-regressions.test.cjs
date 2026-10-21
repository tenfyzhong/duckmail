const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { act, create } = require('react-test-renderer')

global.IS_REACT_ACT_ENVIRONMENT = true
const root = path.resolve(__dirname, '..')
function sourceLoader(mocks = {}) {
  const cache = new Map()
  return function load(relativePath) {
    const absolutePath = path.resolve(root, relativePath)
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports
    const result = { exports: {} }
    cache.set(absolutePath, result)
    const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      fileName: absolutePath,
    }).outputText
    const resolve = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
      if (specifier.startsWith('@/')) {
        const name = specifier.slice(2)
        const candidate = [name, `${name}.ts`, `${name}.tsx`].find(file => fs.existsSync(path.join(root, file)))
        return load(candidate)
      }
      return require(specifier)
    }
    Function('require', 'module', 'exports', compiled)(resolve, result, result.exports)
    return result.exports
  }
}
const load = sourceLoader()
const { restoreAuthState, EMPTY_AUTH_STATE, shouldPersistAuth } = load('lib/auth-storage.ts')
const { createObservableValue } = load('lib/observable-value.ts')
const { createRestoredSnapshot } = load('lib/restored-snapshot.ts')

test('auth restoration keeps anonymous state when storage is empty', () => {
  assert.equal(restoreAuthState(null), EMPTY_AUTH_STATE)
  assert.equal(shouldPersistAuth(EMPTY_AUTH_STATE), false)
})
test('legacy account migration preserves data and adds only missing provider IDs', () => {
  const old = { token: 'test-token', isAuthenticated: true, accounts: [{ id: 'a', address: 'one@example.test' }], currentAccount: { id: 'a', address: 'one@example.test' } }
  const restored = restoreAuthState(JSON.stringify(old))
  assert.deepEqual(restored.accounts, [{ ...old.accounts[0], providerId: 'duckmail' }])
  assert.deepEqual(restored.currentAccount, { ...old.currentAccount, providerId: 'duckmail' })
  assert.equal(restored.token, old.token)
  assert.equal(restored.isAuthenticated, true)
})
test('existing provider IDs and logged-out saved accounts survive restoration', () => {
  const account = { id: 'b', providerId: 'custom', address: 'two@example.test' }
  const restored = restoreAuthState(JSON.stringify({ token: null, isAuthenticated: false, accounts: [account], currentAccount: null }))
  assert.deepEqual(restored.accounts, [account])
  assert.equal(shouldPersistAuth(restored), true)
})
test('malformed saved JSON is reported to the provider recovery path', () => {
  assert.throws(() => restoreAuthState('{broken'), SyntaxError)
})
test('restored snapshot is stable and reads browser storage only once per mount', () => {
  let reads = 0
  const snapshot = createRestoredSnapshot(() => ({ count: ++reads }))
  assert.equal(snapshot(), snapshot())
  assert.equal(reads, 1)
})
test('mail checking store notifies only on transitions and cleans subscriptions', () => {
  const store = createObservableValue(false)
  const observed = []
  const unsubscribe = store.subscribe(() => observed.push(store.getSnapshot()))
  store.set(true); store.set(true); store.set(false)
  unsubscribe(); store.set(true)
  assert.deepEqual(observed, [true, false])
})

test('hydrated state never reads browser storage during SSR', () => {
  const { useHydratedState } = load('hooks/use-hydrated-state.ts')
  let reads = 0
  const initial = { count: 0 }
  const restore = () => { reads++; return { count: 2 } }
  function View() {
    const [value] = useHydratedState(initial, restore)
    return React.createElement('span', null, value.count)
  }
  assert.equal(renderToString(React.createElement(View)), '<span>0</span>')
  assert.equal(reads, 0)
})
test('hydrated state restores once and functional updates retain later user changes', async () => {
  const { useHydratedState } = load('hooks/use-hydrated-state.ts')
  let reads = 0
  let setValue
  const initial = { count: 0 }
  const restore = () => { reads++; return { count: 2 } }
  function View() {
    const [value, setter] = useHydratedState(initial, restore)
    setValue = setter
    return React.createElement('span', null, value.count)
  }
  let renderer
  await act(() => { renderer = create(React.createElement(View)) })
  assert.deepEqual(renderer.toJSON().children, ['2'])
  await act(() => { setValue(previous => ({ count: previous.count + 1 })) })
  await act(() => { renderer.update(React.createElement(View)) })
  assert.deepEqual(renderer.toJSON().children, ['3'])
  assert.equal(reads, 1)
  await act(() => renderer.unmount())
})

test('auth provider restores without erasing saved accounts and persists refreshed tokens', async () => {
  const data = new Map([['auth', JSON.stringify({ token: 'old-test-token', isAuthenticated: true, accounts: [{ id: 'a', address: 'one@example.test' }], currentAccount: { id: 'a', address: 'one@example.test' } })]])
  const removed = []
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => { removed.push(key); data.delete(key) } }
  global.window = new EventTarget()
  const isolated = sourceLoader({ '@/lib/api': {} })
  const { AuthProvider, useAuth } = isolated('contexts/auth-context.tsx')
  let auth
  function View() { auth = useAuth(); return React.createElement('span', null, auth.accounts.length) }
  let renderer
  await act(() => { renderer = create(React.createElement(AuthProvider, null, React.createElement(View))) })
  assert.deepEqual(removed, [])
  assert.equal(auth.accounts[0].providerId, 'duckmail')
  assert.equal(auth.token, 'old-test-token')
  await act(() => window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: 'new-test-token' } })))
  const saved = JSON.parse(data.get('auth'))
  assert.equal(saved.token, 'new-test-token')
  assert.equal(saved.currentAccount.token, 'new-test-token')
  assert.equal(saved.accounts[0].token, 'new-test-token')
  await act(() => renderer.unmount())
  delete global.localStorage; delete global.window
})

test('mobile subscription reads current media and releases its listener', async () => {
  const listeners = new Set()
  const media = { matches: false, addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener) }
  global.window = { matchMedia: () => media }
  const { useIsMobile } = load('hooks/use-mobile.tsx')
  function View() { return React.createElement('span', null, String(useIsMobile())) }
  let renderer
  await act(() => { renderer = create(React.createElement(View)) })
  assert.deepEqual(renderer.toJSON().children, ['false'])
  await act(() => { media.matches = true; listeners.forEach(listener => listener()) })
  assert.deepEqual(renderer.toJSON().children, ['true'])
  await act(() => renderer.unmount())
  assert.equal(listeners.size, 0)
  delete global.window
})

function formMocks(extra) {
  const elements = names => Object.fromEntries(names.map(name => [name, name.toLowerCase()]))
  return {
    '@heroui/modal': elements(['Modal', 'ModalContent', 'ModalHeader', 'ModalBody', 'ModalFooter']),
    '@heroui/button': { Button: 'button' },
    '@heroui/input': { Input: 'input' },
    '@heroui/card': elements(['Card', 'CardBody', 'CardHeader']),
    '@heroui/react': { Divider: 'divider' },
    'lucide-react': elements(['Eye', 'EyeOff', 'LogIn', 'AlertCircle', 'Trash2', 'Plus', 'Edit3']),
    'next-intl': { useTranslations: () => key => key },
    '@/components/domain-selector': { DomainSelector: 'domain-selector' },
    '@/hooks/use-heroui-toast': { useHeroUIToast: () => ({ toast: () => {} }) },
    ...extra,
  }
}

test('login form keeps close/reopen and changed-account field resets', async () => {
  const isolated = sourceLoader(formMocks({ '@/contexts/auth-context': { useAuth: () => ({ login: async () => {} }) } }))
  const LoginModal = isolated('components/login-modal.tsx').default
  let props = { isOpen: true, onClose: () => {}, accountAddress: 'first@example.test' }
  let renderer
  await act(() => { renderer = create(React.createElement(LoginModal, props)) })
  const input = type => renderer.root.findAllByType('input').find(node => node.props.type === type)
  assert.equal(renderer.root.findByType('domain-selector').props.value, 'example.test')
  await act(() => input('password').props.onChange({ target: { value: 'test-only-password' } }))
  await act(() => renderer.root.findByType('modal').props.onClose())
  assert.equal(input('password').props.value, '')
  props = { ...props, isOpen: false }
  await act(() => renderer.update(React.createElement(LoginModal, props)))
  props = { ...props, isOpen: true, accountAddress: 'second@other.test' }
  await act(() => renderer.update(React.createElement(LoginModal, props)))
  assert.equal(renderer.root.findByType('domain-selector').props.value, 'other.test')
  assert.ok(renderer.root.findAllByType('input').some(node => node.props.value === 'second'))
  await act(() => renderer.unmount())
})

test('settings preserve unsaved edits until the provider key actually changes', async () => {
  let apiKey = 'test-key-one'
  const isolated = sourceLoader(formMocks({ '@/contexts/api-provider-context': { useApiProvider: () => ({ providers: [], apiKey, setApiKey: () => {} }) } }))
  const { SettingsPanel } = isolated('components/settings-panel.tsx')
  const props = { isOpen: true, onClose: () => {} }
  let renderer
  await act(() => { renderer = create(React.createElement(SettingsPanel, props)) })
  const field = () => renderer.root.findAllByType('input').find(node => node.props.type === 'password')
  assert.equal(field().props.value, 'test-key-one')
  await act(() => field().props.onValueChange('unsaved-test-value'))
  await act(() => renderer.update(React.createElement(SettingsPanel, props)))
  assert.equal(field().props.value, 'unsaved-test-value')
  apiKey = 'test-key-two'
  await act(() => renderer.update(React.createElement(SettingsPanel, props)))
  assert.equal(field().props.value, 'test-key-two')
  await act(() => renderer.unmount())
})

test('API provider restoration keeps custom providers, enabled defaults, and local key', async () => {
  const custom = { id: 'test-custom', name: 'Test', baseUrl: 'https://example.test', mercureUrl: 'https://example.test/events', isCustom: true }
  const data = new Map([['custom-api-providers', JSON.stringify([custom])], ['disabled-api-providers', JSON.stringify(['duckmail'])], ['api-key', 'test-only-key']])
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  const isolated = sourceLoader()
  const { ApiProviderProvider, useApiProvider } = isolated('contexts/api-provider-context.tsx')
  let value
  function View() { value = useApiProvider(); return null }
  let renderer
  await act(() => { renderer = create(React.createElement(ApiProviderProvider, null, React.createElement(View))) })
  assert.deepEqual(value.providers.find(provider => provider.id === custom.id), custom)
  assert.deepEqual(value.disabledProviderIds, ['duckmail'])
  assert.equal(value.apiKey, 'test-only-key')
  await act(() => value.toggleProviderEnabled('duckmail'))
  assert.deepEqual(JSON.parse(data.get('disabled-api-providers')), [])
  assert.equal(value.apiKey, 'test-only-key')
  await act(() => renderer.unmount())
  delete global.localStorage
})

test('mail checker exposes in-flight status and clears its interval on unmount', async () => {
  const auth = { token: 'test-token', currentAccount: { id: 'mailbox', providerId: 'duckmail' }, isAuthenticated: true }
  let complete
  let requests = 0
  const intervals = new Map()
  const originalSetInterval = global.setInterval
  const originalClearInterval = global.clearInterval
  global.setInterval = callback => { const id = intervals.size + 1; intervals.set(id, callback); return id }
  global.clearInterval = id => intervals.delete(id)
  try {
    const isolated = sourceLoader({
      '@/contexts/auth-context': { useAuth: () => auth },
      '@/lib/api': { getMessages: () => { requests++; return new Promise(resolve => { complete = resolve }) } },
    })
    const { useMailChecker } = isolated('hooks/use-mail-checker.ts')
    let status
    function View() { status = useMailChecker(); return null }
    let renderer
    await act(() => { renderer = create(React.createElement(View)) })
    assert.equal(status.isChecking, true)
    assert.equal(requests, 1)
    await act(() => intervals.forEach(callback => callback()))
    assert.equal(requests, 1, 'a pending request must not be duplicated')
    await act(async () => { complete({ messages: [] }); await Promise.resolve() })
    assert.equal(status.isChecking, false)
    await act(() => renderer.unmount())
    assert.equal(intervals.size, 0)
  } finally {
    global.setInterval = originalSetInterval
    global.clearInterval = originalClearInterval
  }
})
