import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../config';
import { createSpinner } from '../logger';
import {
  deleteGatewayKey,
  getGatewayKey,
  storeGatewayKey,
} from '../crypto/keyStorage';
import {
  applyRemoteEnv,
  detectRemoteEnv,
  getClaudeSettingsPath,
  restoreRemoteEnv,
} from './claude-settings-env';
import { gatewayHealth, gatewayLogin, gatewaySignup } from './gateway-client';

const RESTART_WARNING =
  'Already-running claude sessions keep their current routing. Restart claude in each terminal to apply.';

const UNAVAILABLE_FEATURES =
  'Unavailable while remote mode is on: Remote Control, voice dictation, /schedule, /code-review ultra, claude.ai connectors, /fast, /usage.';

interface RemoteFlags {
  url?: string;
  username?: string;
  password?: string;
  code?: string;
  minimal?: boolean;
}

function resolveGatewayUrl(flagUrl?: string): string | null {
  if (flagUrl) {
    config.remoteGatewayUrl = flagUrl;
  }
  return config.remoteGatewayUrl;
}

async function promptCredentials(flags: RemoteFlags): Promise<{ username: string; password: string }> {
  if (flags.username && flags.password) {
    return { username: flags.username, password: flags.password };
  }
  const answers = await inquirer.prompt([
    ...(flags.username
      ? []
      : [{ type: 'input' as const, name: 'username', message: 'Username:' }]),
    ...(flags.password
      ? []
      : [{ type: 'password' as const, name: 'password', message: 'Password:', mask: '*' }]),
  ]);
  return {
    username: flags.username ?? answers.username,
    password: flags.password ?? answers.password,
  };
}

export async function remoteLogin(flags: RemoteFlags): Promise<void> {
  const gatewayUrl = resolveGatewayUrl(flags.url);
  if (!gatewayUrl) {
    console.log(chalk.red('No gateway URL configured. Run: forkoff remote login --url https://your-domain.com'));
    return;
  }
  const { username, password } = await promptCredentials(flags);
  const spinner = createSpinner('Logging in to gateway...').start();
  try {
    const result = await gatewayLogin(gatewayUrl, username, password, config.deviceName);
    await storeGatewayKey(result.key);
    config.remoteUsername = username;
    config.remoteAccountName = result.accountName;
    spinner.succeed(`Logged in as ${chalk.cyan(username)} (Claude account: ${chalk.cyan(result.accountName)})`);
    console.log(chalk.dim('Run `forkoff remote start` to route Claude Code through the gateway.'));
  } catch (error) {
    spinner.fail(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export async function remoteSignup(flags: RemoteFlags): Promise<void> {
  const gatewayUrl = resolveGatewayUrl(flags.url);
  if (!gatewayUrl) {
    console.log(chalk.red('No gateway URL configured. Pass --url https://your-domain.com'));
    return;
  }
  const { username, password } = await promptCredentials(flags);
  let inviteCode = flags.code;
  if (!inviteCode) {
    const answer = await inquirer.prompt([
      { type: 'input', name: 'code', message: 'Invite code:' },
    ]);
    inviteCode = answer.code;
  }
  const spinner = createSpinner('Creating gateway account...').start();
  try {
    const result = await gatewaySignup(gatewayUrl, username, password, inviteCode!);
    spinner.succeed(`Account created for ${chalk.cyan(username)} (Claude account: ${chalk.cyan(result.accountName)})`);
    console.log(chalk.dim('Run `forkoff remote login` to get a key, then `forkoff remote start`.'));
  } catch (error) {
    spinner.fail(`Signup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export async function remoteStart(flags: RemoteFlags): Promise<void> {
  const gatewayUrl = resolveGatewayUrl(flags.url);
  if (!gatewayUrl) {
    console.log(chalk.red('No gateway URL configured. Run: forkoff remote login --url https://your-domain.com'));
    return;
  }
  if (flags.username || flags.password) {
    await remoteLogin(flags);
    if (process.exitCode === 1) return;
  }
  const key = await getGatewayKey();
  if (!key) {
    console.log(chalk.red('Not logged in. Run: forkoff remote login'));
    return;
  }

  const health = await gatewayHealth(gatewayUrl);
  if (!health.reachable || !health.gatewayEnabled) {
    const reason = !health.reachable
      ? `Gateway unreachable (${health.error})`
      : 'Gateway feature is disabled on the server';
    const { proceed } = await inquirer.prompt([
      { type: 'confirm', name: 'proceed', message: `${reason}. Activate anyway?`, default: false },
    ]);
    if (!proceed) return;
  }

  const detected = detectRemoteEnv();
  if (config.remoteActive && detected.looksLikeForkoff) {
    console.log(chalk.green('Remote mode is already active.'));
    return;
  }

  if (!config.remoteActive || !config.remoteSavedEnv) {
    const { savedEnv } = applyRemoteEnv(gatewayUrl, key, { minimal: flags.minimal });
    const settings = detectRemoteEnv();
    if (!settings.looksLikeForkoff) {
      console.log(chalk.red('Failed to verify settings.json after write.'));
      return;
    }
    config.remoteSavedEnv = savedEnv;
  } else {
    applyRemoteEnv(gatewayUrl, key, { minimal: flags.minimal });
  }
  config.remoteStartedAt = new Date().toISOString();
  config.remoteActive = true;

  console.log(chalk.green(`\nRemote mode ON — Claude account: ${chalk.cyan(config.remoteAccountName || 'unknown')}`));
  console.log(chalk.dim(`  Gateway: ${gatewayUrl}/gw`));
  console.log(chalk.yellow(`\n  ${RESTART_WARNING}`));
  console.log(chalk.dim(`  ${UNAVAILABLE_FEATURES}`));
}

export async function remoteStop(): Promise<void> {
  const detected = detectRemoteEnv();
  if (!config.remoteActive && !detected.looksLikeForkoff) {
    console.log(chalk.dim('Remote mode is not active.'));
    return;
  }
  const savedEnv = config.remoteSavedEnv ?? {
    ANTHROPIC_BASE_URL: null,
    ANTHROPIC_AUTH_TOKEN: null,
    ENABLE_TOOL_SEARCH: null,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: null,
  };
  try {
    const { warnings } = restoreRemoteEnv(savedEnv);
    for (const warning of warnings) {
      console.log(chalk.yellow(`  ${warning}`));
    }
  } catch (error) {
    console.log(chalk.red(`Failed to restore ${getClaudeSettingsPath()}: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }
  config.remoteActive = false;
  config.remoteSavedEnv = null;
  config.remoteStartedAt = null;
  console.log(chalk.green('Remote mode OFF — Claude Code restored to default routing.'));
  console.log(chalk.yellow(`  ${RESTART_WARNING}`));
}

export async function remoteStatus(): Promise<void> {
  const gatewayUrl = config.remoteGatewayUrl;
  const detected = detectRemoteEnv();
  const key = await getGatewayKey();
  const consistent = config.remoteActive === detected.looksLikeForkoff;

  console.log(chalk.bold('\nRemote Mode Status:'));
  console.log(`  Gateway URL: ${gatewayUrl ? chalk.cyan(gatewayUrl) : chalk.yellow('Not configured')}`);
  console.log(`  Logged in:   ${key ? chalk.green(config.remoteUsername || 'Yes') : chalk.yellow('No')}`);
  console.log(`  Account:     ${config.remoteAccountName ? chalk.cyan(config.remoteAccountName) : chalk.dim('Unknown')}`);
  console.log(`  Mode:        ${config.remoteActive ? chalk.green('Active') : chalk.dim('Inactive')}`);
  if (config.remoteStartedAt) {
    console.log(`  Started At:  ${chalk.dim(config.remoteStartedAt)}`);
  }
  if (!consistent) {
    console.log(chalk.yellow('  Inconsistent state: settings.json does not match. Run `forkoff remote start` or `forkoff remote stop` to repair.'));
  }
  if (gatewayUrl) {
    const health = await gatewayHealth(gatewayUrl);
    const healthText = health.reachable
      ? health.gatewayEnabled
        ? chalk.green(`OK (${health.latencyMs}ms)`)
        : chalk.yellow('Reachable, gateway disabled')
      : chalk.red(`Unreachable (${health.error})`);
    console.log(`  Gateway:     ${healthText}`);
  }
}

export async function remoteLogout(): Promise<void> {
  if (config.remoteActive) {
    await remoteStop();
  }
  await deleteGatewayKey();
  config.remoteUsername = null;
  config.remoteAccountName = null;
  console.log(chalk.green('Logged out of gateway.'));
}
