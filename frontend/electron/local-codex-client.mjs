import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Minimal JSONL client for the bundled Codex app-server protocol. */
export class LocalCodexClient {
  constructor({ executable, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawnProcess = spawn, xiaotBridgePath, xiaotEndpoint } = {}) {
    this.executable = executable || process.env.CODEX_EXEC_PATH || 'codex';
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.spawnProcess = spawnProcess;
    this.xiaotBridgePath = xiaotBridgePath;
    this.xiaotEndpoint = xiaotEndpoint;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
  }

  async start() {
    if (this.process) return;
    const env = { ...process.env };
    if (this.xiaotBridgePath && this.xiaotEndpoint) {
      const codexHome = join(process.env.TANVA_CODEX_HOME || join(process.cwd(), '.tanva-codex'), 'runtime');
      await mkdir(codexHome, { recursive: true });
      const command = process.execPath.replaceAll('\\', '\\\\');
      const bridge = this.xiaotBridgePath.replaceAll('\\', '\\\\');
      const endpoint = this.xiaotEndpoint.replaceAll('"', '\\"');
      await writeFile(join(codexHome, 'config.toml'), `[mcp_servers.tanva_xiaot]\ncommand = "${command}"\nargs = ["${bridge}"]\nenv = { TANVA_XIAOT_AGENT_URL = "${endpoint}" }\n`, { mode: 0o600 });
      env.CODEX_HOME = codexHome;
    }
    this.process = this.spawnProcess(this.executable, ['app-server'], {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => this.#handleLine(line));
    this.process.on('exit', (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'})`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      this.process = null;
    });
  }

  request(method, params = {}) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async startThread(params = {}) { await this.start(); return this.request('thread/start', params); }
  async resumeThread(params = {}) { await this.start(); return this.request('thread/resume', params); }
  async startTurn(params = {}) { return this.request('turn/start', params); }

  async close() {
    if (!this.process) return;
    this.process.kill();
    this.process = null;
  }

  #handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id == null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'Codex app-server error'));
    else pending.resolve(message.result);
  }
}
