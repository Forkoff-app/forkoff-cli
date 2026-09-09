import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import config from '../config';

export const MANAGED_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const;

export function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function readClaudeSettings(): Record<string, any> {
  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const content = fs.readFileSync(settingsPath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(
      `Could not parse ${settingsPath} — fix or remove the invalid JSON before using remote mode`,
    );
  }
}

export function writeClaudeSettingsAtomic(settings: Record<string, any>): void {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const backupPath = settingsPath + '.forkoff-remote.bak';
  if (fs.existsSync(settingsPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(settingsPath, backupPath);
  }
  const tmpPath = settingsPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmpPath, settingsPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
}

export function gatewayBaseUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '') + '/gw';
}

export function applyRemoteEnv(
  gatewayUrl: string,
  gatewayKey: string,
  options: { minimal?: boolean } = {},
): { savedEnv: Record<string, string | null> } {
  const settings = readClaudeSettings();
  const env: Record<string, string> = { ...(settings.env || {}) };
  const savedEnv: Record<string, string | null> = {};
  for (const key of MANAGED_KEYS) {
    savedEnv[key] = key in env ? env[key] : null;
  }
  env['ANTHROPIC_BASE_URL'] = gatewayBaseUrl(gatewayUrl);
  env['ANTHROPIC_AUTH_TOKEN'] = gatewayKey;
  env['ENABLE_TOOL_SEARCH'] = 'true';
  if (options.minimal) {
    env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';
  } else {
    delete env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
  }
  settings.env = env;
  writeClaudeSettingsAtomic(settings);
  return { savedEnv };
}

export function restoreRemoteEnv(
  savedEnv: Record<string, string | null>,
): { warnings: string[] } {
  const warnings: string[] = [];
  const settings = readClaudeSettings();
  const env: Record<string, string> = { ...(settings.env || {}) };
  const gatewayUrl = config.remoteGatewayUrl;
  const expectedBase = gatewayUrl ? gatewayBaseUrl(gatewayUrl) : null;
  if (
    expectedBase &&
    env['ANTHROPIC_BASE_URL'] &&
    env['ANTHROPIC_BASE_URL'] !== expectedBase &&
    env['ANTHROPIC_BASE_URL'] !== savedEnv['ANTHROPIC_BASE_URL']
  ) {
    warnings.push(
      `ANTHROPIC_BASE_URL was changed manually (${env['ANTHROPIC_BASE_URL']}); restoring saved value anyway`,
    );
  }
  for (const key of MANAGED_KEYS) {
    const original = savedEnv[key];
    if (original === null || original === undefined) {
      delete env[key];
    } else {
      env[key] = original;
    }
  }
  if (Object.keys(env).length === 0) {
    delete settings.env;
  } else {
    settings.env = env;
  }
  writeClaudeSettingsAtomic(settings);
  return { warnings };
}

export function detectRemoteEnv(): {
  baseUrl: string | null;
  hasAuthToken: boolean;
  looksLikeForkoff: boolean;
} {
  let settings: Record<string, any>;
  try {
    settings = readClaudeSettings();
  } catch {
    return { baseUrl: null, hasAuthToken: false, looksLikeForkoff: false };
  }
  const env = settings.env || {};
  const baseUrl = env['ANTHROPIC_BASE_URL'] || null;
  const gatewayUrl = config.remoteGatewayUrl;
  return {
    baseUrl,
    hasAuthToken: !!env['ANTHROPIC_AUTH_TOKEN'],
    looksLikeForkoff:
      !!baseUrl && !!gatewayUrl && baseUrl === gatewayBaseUrl(gatewayUrl),
  };
}
