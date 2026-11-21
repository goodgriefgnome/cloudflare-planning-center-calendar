import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real Workers runtime fetches Planning Center and rejects redirects without forwarding credentials', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `
        import { fetchInstances } from './src/pco.js';
        export default {
          async fetch() {
            try {
              const result = await fetchInstances(
                { PCO_APPLICATION_ID: 'fixture-id', PCO_SECRET: 'fixture-secret' },
                '2026-11-21T00:00:00Z', '2027-11-21T00:00:00Z'
              );
              return Response.json({ ok: true, pages: result.pages });
            } catch (error) {
              return Response.json({ ok: false, code: error.code, message: error.message });
            }
          }
        };
      `,
    },
    bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  let status = 200, calls = 0;
  // All outbound HTTP is intercepted: no real API, credentials or network needed.
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-01',
    outboundService: async (request) => {
      calls++;
      assert.equal(new URL(request.url).origin, 'https://api.planningcenteronline.com');
      assert.equal(request.headers.get('Authorization'), `Basic ${btoa('fixture-id:fixture-secret')}`);
      return status === 302
        ? new Response(null, { status, headers: { Location: 'https://foreign.example/redirect' } })
        : Response.json({ data: [], included: [], links: { next: null } });
    },
  }));
  try {
    const success = await (await mf.dispatchFetch('https://fixture.example')).json();
    assert.deepEqual(success, { ok: true, pages: 1 });
    assert.equal(calls, 1);
    calls = 0; status = 302;
    const redirect = await (await mf.dispatchFetch('https://fixture.example')).json();
    assert.equal(redirect.ok, false);
    assert.equal(redirect.code, 'PCO_HTTP_302');
    assert.equal(calls, 1, 'must not follow the Location header');
  } finally {
    await mf.dispose();
  }
});
