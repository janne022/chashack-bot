import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromePath } from './chrome-path.mjs';

export async function startChrome(profile, { executable = chromePath, args = [], timeoutMs = 10000 } = {}) {
  const chrome = spawn(executable, [...args, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }); // g0:allow:secrets t_15e7ed4e — public Chromium launch flags, no credential.
  let stderr = '', spawnError, announcedUrl, lastEndpointError = 'no endpoint published';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-8192);
    announcedUrl = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1] ?? announcedUrl;
  });
  chrome.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => chrome.once('close', resolve));
  const stop = async () => {
    if (chrome.pid) {
      try { process.kill(-chrome.pid, 'SIGTERM'); } catch {}
      // The owned process group may outlive the launcher (e.g. a Chrome wrapper).
      const timer = setTimeout(() => { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }, 3000);
      try { await closed; } finally { clearTimeout(timer); }
    }
  };
  try {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (spawnError) throw spawnError;
      if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error('browser exited before readiness');
      try {
        // Chrome announces CDP on stderr; do not depend solely on a profile file.
        const port = announcedUrl ? new URL(announcedUrl).port : (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
        if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid DevTools port');
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const version = await response.json();
        const ws = new URL(version.webSocketDebuggerUrl);
        if (ws.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname) || ws.port !== port) throw new Error('invalid DevTools WebSocket URL');
        console.log(`CHROMIUM READY executable=${executable} pid=${chrome.pid} source=${announcedUrl ? 'stderr' : 'profile'} browser=${version.Browser ?? 'unknown'} endpoint=${ws.href}`);
        return { wsUrl: ws.href, pid: chrome.pid, stop };
      } catch (error) { lastEndpointError = error.message; }
      await delay(100);
    }
    throw new Error('Chromium DevTools endpoint did not start');
  } catch (error) {
    const diagnostic = `Chromium startup failed: ${error.message}; executable=${executable} pid=${chrome.pid ?? 'unspawned'} code=${chrome.exitCode} signal=${chrome.signalCode}; lastEndpointError=${lastEndpointError}; stderr=${stderr || '(empty)'}`;
    await stop();
    throw new Error(diagnostic, { cause: error });
  }
}
