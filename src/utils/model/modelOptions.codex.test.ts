import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'
import { saveGlobalConfig } from '../config.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
// Imported up front so the mock factory can spread the real export surface.
// `mock.module()` is process-global in bun:test and `mock.restore()` does not
// undo it, so auth.js is restored to actual in afterEach (see effort.codex.test.ts).
import * as actualAuth from '../auth.js'

function restoreMockedModulesToActual(): void {
  mock.module('../auth.js', () => actualAuth)
}

async function importFreshModelOptionsModule() {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => 'codex',
    getAPIProviderForStatsig: () => 'codex',
    isFirstPartyAnthropicBaseUrl: () => false,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  // Force the PAYG-3P (Codex) picker branch: on a machine with real Claude
  // subscription credentials, getModelOptions would otherwise return the
  // subscriber list before reaching getCodexModelOptions.
  mock.module('../auth.js', () => ({
    ...actualAuth,
    isClaudeAISubscriber: () => false,
    isMaxSubscriber: () => false,
    isTeamPremiumSubscriber: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

async function getCodexPickerValues(): Promise<string[]> {
  const { getModelOptions } = await importFreshModelOptionsModule()
  return getModelOptions().map(option => option.value)
}

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CODEX_CREDENTIAL_SOURCE: process.env.CODEX_CREDENTIAL_SOURCE,
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
  CODEX_ACCOUNT_ID: process.env.CODEX_ACCOUNT_ID,
}

function restoreEnvValue(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireEnvMutex()
  mock.restore()
  setSessionSettingsCache({ settings: {}, errors: [] })
  for (const key of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
    delete process.env[key]
  }
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  try {
    mock.restore()
    restoreMockedModulesToActual()
    resetSettingsCache()
    for (const key of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
      restoreEnvValue(key)
    }
    saveGlobalConfig(current => ({
      ...current,
      providerProfiles: [],
      activeProviderProfileId: undefined,
    }))
    resetModelStringsForTestingOnly()
  } finally {
    releaseEnvMutex()
  }
})

test('Codex picker surfaces the gpt-5.6 family alongside the existing entries', async () => {
  const values = await getCodexPickerValues()

  expect(values).toContain('gpt-5.6-sol')
  expect(values).toContain('gpt-5.6-terra')
  expect(values).toContain('gpt-5.6-luna')

  // Existing Codex picker entries stay put.
  expect(values).toContain('gpt-5.5')
  expect(values).toContain('gpt-5.4')
  expect(values).toContain('gpt-5.3-codex')

  // Each new value appears exactly once (no accidental duplication).
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    expect(values.filter(value => value === model)).toHaveLength(1)
  }
})

test('gpt-5.6 entries lead the Codex list (newest first, before gpt-5.5)', async () => {
  const values = await getCodexPickerValues()

  expect(values.indexOf('gpt-5.6-sol')).toBeLessThan(values.indexOf('gpt-5.5'))
  expect(values.indexOf('gpt-5.6-terra')).toBeLessThan(values.indexOf('gpt-5.5'))
  expect(values.indexOf('gpt-5.6-luna')).toBeLessThan(values.indexOf('gpt-5.5'))
})
