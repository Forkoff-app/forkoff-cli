import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: jest.fn(() => (globalThis as any).__forkoffTestHome ?? actual.homedir()),
  };
});

const tmpHome = fs.mkdtempSync(path.join(jest.requireActual('os').tmpdir(), 'forkoff-remote-test-'));
(globalThis as any).__forkoffTestHome = tmpHome;

jest.mock('../config', () => {
  const store: Record<string, any> = { remoteGatewayUrl: 'https://gw.example.com' };
  return {
    __esModule: true,
    config: new Proxy(store, {
      get: (target, prop: string) => target[prop],
      set: (target, prop: string, value) => {
        target[prop] = value;
        return true;
      },
    }),
    default: new Proxy(store, {
      get: (target, prop: string) => target[prop],
      set: (target, prop: string, value) => {
        target[prop] = value;
        return true;
      },
    }),
  };
});

import {
  applyRemoteEnv,
  detectRemoteEnv,
  gatewayBaseUrl,
  getClaudeSettingsPath,
  restoreRemoteEnv,
} from '../remote/claude-settings-env';

const settingsDir = path.join(tmpHome, '.claude');
const settingsPath = path.join(settingsDir, 'settings.json');

function writeSettings(obj: any): void {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2));
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

beforeEach(() => {
  fs.rmSync(settingsDir, { recursive: true, force: true });
});

describe('gatewayBaseUrl', () => {
  it('appends /gw and strips trailing slashes', () => {
    expect(gatewayBaseUrl('https://gw.example.com')).toBe('https://gw.example.com/gw');
    expect(gatewayBaseUrl('https://gw.example.com//')).toBe('https://gw.example.com/gw');
  });
});

describe('applyRemoteEnv / restoreRemoteEnv', () => {
  it('round-trips with no pre-existing settings file', () => {
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    const applied = readSettings();
    expect(applied.env.ANTHROPIC_BASE_URL).toBe('https://gw.example.com/gw');
    expect(applied.env.ANTHROPIC_AUTH_TOKEN).toBe('fkgw_abc');
    expect(applied.env.ENABLE_TOOL_SEARCH).toBe('true');

    restoreRemoteEnv(savedEnv);
    const restored = readSettings();
    expect(restored.env).toBeUndefined();
  });

  it('preserves unrelated settings keys through the round-trip', () => {
    writeSettings({
      hooks: { PreToolUse: [{ matcher: '.*', hooks: ['forkoff-hook'] }] },
      model: 'opus',
      env: { EXISTING_VAR: 'keep-me' },
    });
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    restoreRemoteEnv(savedEnv);
    const restored = readSettings();
    expect(restored.hooks.PreToolUse[0].hooks).toContain('forkoff-hook');
    expect(restored.model).toBe('opus');
    expect(restored.env).toEqual({ EXISTING_VAR: 'keep-me' });
  });

  it('saves and restores a pre-existing ANTHROPIC_BASE_URL', () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: 'https://other-proxy.corp' } });
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    expect(savedEnv.ANTHROPIC_BASE_URL).toBe('https://other-proxy.corp');
    expect(readSettings().env.ANTHROPIC_BASE_URL).toBe('https://gw.example.com/gw');

    restoreRemoteEnv(savedEnv);
    expect(readSettings().env.ANTHROPIC_BASE_URL).toBe('https://other-proxy.corp');
  });

  it('marks absent keys as null and deletes them on restore', () => {
    writeSettings({ env: { OTHER: 'x' } });
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    expect(savedEnv.ANTHROPIC_AUTH_TOKEN).toBeNull();
    restoreRemoteEnv(savedEnv);
    const restored = readSettings();
    expect(restored.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(restored.env.OTHER).toBe('x');
  });

  it('warns when the base URL drifted before restore', () => {
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    const drifted = readSettings();
    drifted.env.ANTHROPIC_BASE_URL = 'https://manually-changed.example';
    writeSettings(drifted);
    const { warnings } = restoreRemoteEnv(savedEnv);
    expect(warnings.length).toBe(1);
    expect(readSettings().env).toBeUndefined();
  });

  it('creates a one-time backup before the first managed write', () => {
    writeSettings({ model: 'opus' });
    applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    const backup = JSON.parse(
      fs.readFileSync(settingsPath + '.forkoff-remote.bak', 'utf-8'),
    );
    expect(backup).toEqual({ model: 'opus' });
  });

  it('leaves no temp files behind', () => {
    applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    const leftovers = fs.readdirSync(settingsDir).filter((f) => f.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });

  it('minimal flag adds the nonessential-traffic kill switch and restore removes it', () => {
    const { savedEnv } = applyRemoteEnv('https://gw.example.com', 'fkgw_abc', { minimal: true });
    expect(readSettings().env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    restoreRemoteEnv(savedEnv);
    expect(readSettings().env).toBeUndefined();
  });
});

describe('detectRemoteEnv', () => {
  it('detects forkoff routing', () => {
    applyRemoteEnv('https://gw.example.com', 'fkgw_abc');
    const detected = detectRemoteEnv();
    expect(detected.looksLikeForkoff).toBe(true);
    expect(detected.hasAuthToken).toBe(true);
  });

  it('does not flag foreign proxies as forkoff', () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: 'https://other.example/gw2' } });
    expect(detectRemoteEnv().looksLikeForkoff).toBe(false);
  });

  it('handles a missing settings file', () => {
    const detected = detectRemoteEnv();
    expect(detected.baseUrl).toBeNull();
    expect(detected.looksLikeForkoff).toBe(false);
  });
});

describe('getClaudeSettingsPath', () => {
  it('points inside the mocked home', () => {
    expect(getClaudeSettingsPath()).toBe(settingsPath);
  });
});
