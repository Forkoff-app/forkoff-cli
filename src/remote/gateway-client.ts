export interface GatewayLoginResult {
  key: string;
  accountName: string;
}

export interface GatewaySignupResult {
  accountName: string;
}

export interface GatewayHealthResult {
  reachable: boolean;
  gatewayEnabled: boolean;
  latencyMs: number | null;
  error?: string;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as any;
    return body.message || body.error?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function gatewayLogin(
  gatewayUrl: string,
  username: string,
  password: string,
  label: string,
): Promise<GatewayLoginResult> {
  const response = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/api/gateway/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, label }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<GatewayLoginResult>;
}

export async function gatewaySignup(
  gatewayUrl: string,
  username: string,
  password: string,
  inviteCode: string,
): Promise<GatewaySignupResult> {
  const response = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/api/gateway/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<GatewaySignupResult>;
}

export async function gatewayHealth(gatewayUrl: string): Promise<GatewayHealthResult> {
  const started = Date.now();
  try {
    const response = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/api/gateway/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        reachable: false,
        gatewayEnabled: false,
        latencyMs: null,
        error: `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as any;
    return {
      reachable: true,
      gatewayEnabled: body.gateway === true,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      reachable: false,
      gatewayEnabled: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
