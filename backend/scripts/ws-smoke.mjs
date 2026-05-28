// backend/scripts/ws-smoke.mjs
// 用法:
//   TOKEN=<access_token> TEAM_ID=<teamId> PROJECT_ID=<projectId> node scripts/ws-smoke.mjs
//   (PROJECT_ID 可选；不传则只验证 credits/鉴权通道)
import WebSocket from 'ws';

const BASE = process.env.WS_BASE || 'ws://localhost:4000';
const TOKEN = process.env.TOKEN || '';
const TEAM_ID = process.env.TEAM_ID || '';
const PROJECT_ID = process.env.PROJECT_ID || '';

if (!TOKEN || !TEAM_ID) {
  console.error('需要 TOKEN 和 TEAM_ID 环境变量');
  process.exit(2);
}

const q = (extra) => {
  const p = new URLSearchParams({ token: TOKEN, teamId: TEAM_ID, ...extra });
  return `${BASE}/ws/collab?${p.toString()}`;
};

function open(label, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => reject(new Error(`${label} 连接超时`)), 5000);
    ws.on('open', () => console.log(`[${label}] open`));
    ws.on('message', (raw) => {
      const env = JSON.parse(raw.toString());
      console.log(`[${label}] <-`, env.type, JSON.stringify(env.payload).slice(0, 120));
      if (env.type === 'connected') {
        clearTimeout(t);
        resolve(ws);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(new Error(`${label} error: ${e.message}`));
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(t);
      reject(new Error(`${label} handshake rejected: HTTP ${res.statusCode}`));
    });
  });
}

async function main() {
  // 1) 鉴权失败必须被拒
  await new Promise((resolve) => {
    const ws = new WebSocket(q({ token: 'bad-token' }));
    ws.on('open', () => {
      console.error('FAIL: 坏 token 竟然握手成功');
      process.exit(1);
    });
    ws.on('unexpected-response', (_r, res) => {
      console.log(`OK: 坏 token 被拒 (HTTP ${res.statusCode})`);
      resolve();
    });
    ws.on('error', () => resolve()); // 某些环境直接 error，也算拒绝
  });

  // 2) 合法连接拿到 connected ack
  const a = await open('A', q(PROJECT_ID ? { projectId: PROJECT_ID } : {}));
  console.log('OK: 合法连接收到 connected ack');

  // 3) 若有 projectId，开第二个客户端验证光标互通
  if (PROJECT_ID) {
    const cursorSeen = new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error('B 未收到 A 的 cursor')), 5000);
      const b = open('B', q({ projectId: PROJECT_ID }));
      b.then((ws) => {
        ws.on('message', (raw) => {
          const env = JSON.parse(raw.toString());
          if (env.type === 'cursor' && env.payload?.x === 123) {
            clearTimeout(tm);
            console.log('OK: B 收到 A 的 cursor 广播');
            resolve();
          }
        });
        // A 发一个光标
        setTimeout(() => a.send(JSON.stringify({ type: 'cursor', payload: { x: 123, y: 456 } })), 300);
      }).catch(reject);
    });
    await cursorSeen;
  }

  console.log('SMOKE PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});
