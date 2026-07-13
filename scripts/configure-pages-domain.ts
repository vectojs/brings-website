type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type Sleep = (milliseconds: number) => Promise<void>;

type ApiEnvelope<T> = Readonly<{
  success: boolean;
  result: T;
  errors?: readonly Readonly<{ code?: number; message?: string }>[];
}>;

type PagesDomain = Readonly<{
  name: string;
  status: 'initializing' | 'pending' | 'active' | 'deactivated' | 'blocked' | 'error';
  zone_tag: string;
  validation_data?: Readonly<{ status?: string; error_message?: string }>;
  verification_data?: Readonly<{ status?: string; error_message?: string }>;
}>;

type DnsRecord = Readonly<{
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}>;

export type ConfigurePagesDomainOptions = Readonly<{
  accountId: string;
  apiToken: string;
  projectName: string;
  domainName: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  activationAttempts?: number;
}>;

const API_BASE = 'https://api.cloudflare.com/client/v4';
const TERMINAL_DOMAIN_STATUSES = new Set(['deactivated', 'blocked', 'error']);

function assertIdentifier(value: string, label: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw new Error(`Invalid ${label}.`);
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, '');
}

function apiErrorMessage<T>(response: Response, envelope: ApiEnvelope<T> | null): string {
  const detail = envelope?.errors?.map(({ message }) => message).find(Boolean);
  return detail === undefined
    ? `Cloudflare API request failed with HTTP ${response.status}.`
    : `Cloudflare API request failed with HTTP ${response.status}: ${detail}`;
}

async function requestResult<T>(
  fetchImpl: FetchLike,
  url: string,
  apiToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || envelope?.success !== true)
    throw new Error(apiErrorMessage(response, envelope));
  return envelope.result;
}

async function getPagesDomain(
  fetchImpl: FetchLike,
  url: string,
  apiToken: string,
): Promise<PagesDomain | null> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (response.status === 404) return null;
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<PagesDomain> | null;
  if (!response.ok || envelope?.success !== true)
    throw new Error(apiErrorMessage(response, envelope));
  return envelope.result;
}

function assertDomainShape(domain: PagesDomain, domainName: string): void {
  if (domain.name !== domainName || !domain.zone_tag || !domain.status) {
    throw new Error('Cloudflare Pages returned an incomplete domain response.');
  }
}

function terminalDomainError(domain: PagesDomain): Error {
  const detail =
    domain.validation_data?.error_message ?? domain.verification_data?.error_message ?? '';
  const suffix = detail === '' ? '' : `: ${detail}`;
  return new Error(
    `Cloudflare Pages domain ${domain.name} entered terminal status ${domain.status}${suffix}.`,
  );
}

async function ensureDnsRecord(
  options: ConfigurePagesDomainOptions,
  fetchImpl: FetchLike,
  domain: PagesDomain,
): Promise<boolean> {
  const expectedTarget = `${options.projectName}.pages.dev`;
  const query = new URLSearchParams({ name: options.domainName });
  const recordsUrl = `${API_BASE}/zones/${domain.zone_tag}/dns_records`;
  const records = await requestResult<readonly DnsRecord[]>(
    fetchImpl,
    `${recordsUrl}?${query.toString()}`,
    options.apiToken,
  );

  if (records.length === 0) {
    await requestResult<DnsRecord>(fetchImpl, recordsUrl, options.apiToken, {
      method: 'POST',
      body: JSON.stringify({
        type: 'CNAME',
        name: options.domainName,
        content: expectedTarget,
        ttl: 1,
        proxied: true,
      }),
    });
    return true;
  }

  if (
    records.length !== 1 ||
    records[0]?.type !== 'CNAME' ||
    normalizedHostname(records[0].content) !== expectedTarget
  ) {
    throw new Error(
      `Conflicting DNS record for ${options.domainName}; expected one CNAME to ${expectedTarget}.`,
    );
  }
  return false;
}

/** Reconcile one Pages custom domain, its DNS record, and activation state. */
export async function configurePagesDomain(options: ConfigurePagesDomainOptions): Promise<void> {
  assertIdentifier(options.projectName, 'Pages project name', /^[a-z0-9-]+$/);
  assertIdentifier(options.domainName, 'domain name', /^[a-z0-9.-]+$/);
  assertIdentifier(options.accountId, 'Cloudflare account ID', /^[A-Za-z0-9_-]+$/);
  if (options.apiToken.length === 0) throw new Error('Cloudflare API token is required.');

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  const activationAttempts = options.activationAttempts ?? 30;
  if (!Number.isSafeInteger(activationAttempts) || activationAttempts < 1) {
    throw new Error('activationAttempts must be a positive safe integer.');
  }

  const domainsUrl = `${API_BASE}/accounts/${options.accountId}/pages/projects/${options.projectName}/domains`;
  const domainUrl = `${domainsUrl}/${options.domainName}`;
  let domain = await getPagesDomain(fetchImpl, domainUrl, options.apiToken);
  if (domain === null) {
    domain = await requestResult<PagesDomain>(fetchImpl, domainsUrl, options.apiToken, {
      method: 'POST',
      body: JSON.stringify({ name: options.domainName }),
    });
  }
  assertDomainShape(domain, options.domainName);

  const dnsCreated = await ensureDnsRecord(options, fetchImpl, domain);
  if (domain.status === 'active') {
    console.log(
      `Cloudflare Pages domain ${options.domainName} is active${dnsCreated ? ' with a new DNS record' : ''}.`,
    );
    return;
  }

  domain = await requestResult<PagesDomain>(fetchImpl, domainUrl, options.apiToken, {
    method: 'PATCH',
    body: '{}',
  });
  assertDomainShape(domain, options.domainName);
  if (TERMINAL_DOMAIN_STATUSES.has(domain.status)) throw terminalDomainError(domain);

  for (let attempt = 0; attempt < activationAttempts; attempt += 1) {
    if (domain.status === 'active') {
      console.log(`Cloudflare Pages domain ${options.domainName} is active.`);
      return;
    }
    await sleep(2_000);
    const refreshed = await getPagesDomain(fetchImpl, domainUrl, options.apiToken);
    if (refreshed === null)
      throw new Error(`Cloudflare Pages domain ${options.domainName} disappeared.`);
    domain = refreshed;
    assertDomainShape(domain, options.domainName);
    if (TERMINAL_DOMAIN_STATUSES.has(domain.status)) throw terminalDomainError(domain);
  }

  throw new Error(
    `Cloudflare Pages domain ${options.domainName} did not become active after ${activationAttempts} checks.`,
  );
}

if (import.meta.main) {
  const [projectName, domainName] = process.argv.slice(2);
  if (projectName === undefined || domainName === undefined) {
    console.error('Usage: bun scripts/configure-pages-domain.ts <project_name> <domain_name>');
    process.exitCode = 1;
  } else {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
    configurePagesDomain({ accountId, apiToken, projectName, domainName }).catch(
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      },
    );
  }
}
