import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startChrome } from './chrome-startup.mjs';

// Real child processes and HTTP sockets; no Chromium or database needed.
test('startup uses the announced endpoint, diagnoses failure and cleans up its child', { timeout: 15000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-startup-test-'));
  const fixture = join(profile, 'browser.cjs');
  try {
    await writeFile(fixture, `
      const {createServer} = require('node:http');
      const {writeFileSync} = require('node:fs');
      writeFileSync(${JSON.stringify(join(profile, 'pid'))}, String(process.pid));
      const mode = process.argv[2];
      if (mode === 'exit') { process.stderr.write('x'.repeat(20000) + ' startup-fixture-fatal'); process.exitCode = 42; }
      else {
        const server = createServer((req, res) => {
          if (mode === 'hang') return;
          res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:'+server.address().port+'/devtools/browser/fixture'}));
        }).listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          if (mode === 'file' || mode === 'hang') writeFileSync(${JSON.stringify(join(profile, 'DevToolsActivePort'))}, port+'\\n/devtools/browser/fixture');
          else process.stderr.write('DevTools listening on ws://127.0.0.1:'+port+'/devtools/browser/fixture\\n');
        });
      }
    `);
    for (const mode of ['stderr', 'file']) {
      const browser = await startChrome(profile, { executable: process.execPath, args: [fixture, mode], timeoutMs: 1000 });
      assert.match(browser.wsUrl, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/fixture$/);
      await browser.stop();
      assert.throws(() => process.kill(Number(browser.pid), 0), /ESRCH/);
      await rm(join(profile, 'DevToolsActivePort'), { force: true });
    }
    await assert.rejects(startChrome(profile, { executable: process.execPath, args: [fixture, 'exit'], timeoutMs: 1000 }), error => {
      assert.match(error.message, /code=42/);
      assert.match(error.message, /startup-fixture-fatal/);
      assert.match(error.message, /executable=.*node.*pid=\d+/);
      assert.ok(error.message.length < 10000, 'bounded stderr tail');
      return true;
    });
    await assert.rejects(startChrome(profile, { executable: join(profile, 'missing'), timeoutMs: 1000 }), /ENOENT/);
    const started = performance.now();
    await assert.rejects(startChrome(profile, { executable: process.execPath, args: [fixture, 'hang'], timeoutMs: 400 }), /lastEndpointError=.*Timeout|lastEndpointError=.*abort/i);
    assert.ok(performance.now() - started < 3000, 'hung HTTP probe obeys startup deadline');
    const pid = Number(await readFile(join(profile, 'pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'failed startup child was reaped');
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
