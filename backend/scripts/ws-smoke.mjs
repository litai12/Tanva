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

  // 3) 若有 projectId，用 presence_join 验证项目频道的跨连接扇出。
  //    注意：用同一 token 开两个客户端 = 同一 userId，光标会被服务端按 senderUserId
  //    自我抑制（不回推自己），故光标的「跨用户」投递无法用单 token 验证——这里用
  //    presence 扇出证明同一条 publish→fanout 投递路径可用；光标走完全相同的路径。
  if (PROJECT_ID) {
    const fanoutSeen = new Promise((resolve, reject) => {
      const tm = setTimeout(
        () => reject(new Error('A 未收到 B 的 presence_join（项目频道扇出失败）')),
        5000,
      );
      a.on('message', (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.type === 'presence_join') {
          clearTimeout(tm);
          console.log('OK: 项目频道扇出正常（A 收到新连接的 presence_join）');
          resolve();
        }
      });
      open('B', q({ projectId: PROJECT_ID })).catch(reject);
    });
    await fanoutSeen;
    console.log(
      'NOTE: 光标跨用户投递需两个不同账号验证（单 token 同用户会被自我抑制），请在双浏览器人工验收。',
    );
  }

  console.log('SMOKE PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});
