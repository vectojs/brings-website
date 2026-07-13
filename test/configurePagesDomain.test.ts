import { expect, test } from 'bun:test';
import {
  configurePagesDomain,
  type ConfigurePagesDomainOptions,
} from '../scripts/configure-pages-domain';

type FetchCall = Readonly<{
  url: string;
  method: string;
  body: unknown;
}>;

function apiResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness(responses: readonly Response[]): {
  options: ConfigurePagesDomainOptions;
  calls: FetchCall[];
} {
  const queue = [...responses];
  const calls: FetchCall[] = [];
  return {
    calls,
    options: {
      accountId: 'account-1',
      apiToken: 'token-1',
      projectName: 'brings-website',
      domainName: 'brings-website.vectojs.org',
      fetch: async (input, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body,
        });
        const response = queue.shift();
        if (response === undefined) throw new Error('Unexpected Cloudflare API request.');
        return response;
      },
      sleep: async () => {},
      activationAttempts: 3,
    },
  };
}

const pendingDomain = {
  name: 'brings-website.vectojs.org',
  status: 'pending',
  zone_tag: 'zone-1',
  validation_data: { status: 'pending' },
  verification_data: { status: 'pending' },
};

const optionsDomain = 'brings-website.vectojs.org';

test('creates a missing Pages CNAME, retries validation, and waits for activation', async () => {
  const { options, calls } = harness([
    apiResponse(pendingDomain),
    apiResponse([]),
    apiResponse({
      id: 'record-1',
      type: 'CNAME',
      name: optionsDomain,
      content: 'brings-website.pages.dev',
      proxied: true,
    }),
    apiResponse(pendingDomain),
    apiResponse({ ...pendingDomain, status: 'active' }),
  ]);

  await configurePagesDomain(options);

  expect(calls.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST', 'PATCH', 'GET']);
  expect(calls[2]).toMatchObject({
    url: 'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records',
    method: 'POST',
    body: {
      type: 'CNAME',
      name: 'brings-website.vectojs.org',
      content: 'brings-website.pages.dev',
      ttl: 1,
      proxied: true,
    },
  });
});

test('associates the Pages domain before creating its DNS record', async () => {
  const { options, calls } = harness([
    apiResponse(null, 404),
    apiResponse(pendingDomain),
    apiResponse([]),
    apiResponse({
      id: 'record-1',
      type: 'CNAME',
      name: optionsDomain,
      content: 'brings-website.pages.dev',
      proxied: true,
    }),
    apiResponse({ ...pendingDomain, status: 'active' }),
  ]);

  await configurePagesDomain(options);
  expect(calls.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET', 'POST', 'PATCH']);
  expect(calls[1]).toMatchObject({
    url: 'https://api.cloudflare.com/client/v4/accounts/account-1/pages/projects/brings-website/domains',
    method: 'POST',
    body: { name: optionsDomain },
  });
});

test('leaves an active domain with the correct existing CNAME unchanged', async () => {
  const { options, calls } = harness([
    apiResponse({ ...pendingDomain, status: 'active' }),
    apiResponse([
      {
        id: 'record-1',
        type: 'CNAME',
        name: optionsDomain,
        content: 'brings-website.pages.dev',
        proxied: true,
      },
    ]),
  ]);

  await configurePagesDomain(options);
  expect(calls.map(({ method }) => method)).toEqual(['GET', 'GET']);
});

test('fails safely instead of overwriting a conflicting exact-name DNS record', async () => {
  const { options, calls } = harness([
    apiResponse(pendingDomain),
    apiResponse([
      {
        id: 'record-1',
        type: 'A',
        name: optionsDomain,
        content: '192.0.2.1',
        proxied: true,
      },
    ]),
  ]);

  await expect(configurePagesDomain(options)).rejects.toThrow(
    'Conflicting DNS record for brings-website.vectojs.org',
  );
  expect(calls.map(({ method }) => method)).toEqual(['GET', 'GET']);
});

test('surfaces terminal Pages activation failures', async () => {
  const { options } = harness([
    apiResponse({ ...pendingDomain, status: 'error' }),
    apiResponse([
      {
        id: 'record-1',
        type: 'CNAME',
        name: optionsDomain,
        content: 'brings-website.pages.dev',
        proxied: true,
      },
    ]),
    apiResponse({ ...pendingDomain, status: 'error' }),
  ]);

  await expect(configurePagesDomain(options)).rejects.toThrow(
    'Cloudflare Pages domain brings-website.vectojs.org entered terminal status error',
  );
});
