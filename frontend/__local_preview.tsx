import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import MobileApp from './src/pages/mobile/MobileApp';
import { useAuthStore } from './src/stores/authStore';
import { authApi } from './src/services/authApi';
import { mobileChatApi, type MobileMessage } from './src/services/mobileChatApi';
import './src/index.css';

const chats = [
  { id: 'preview-1', title: '帮我做一套商品详情页', lastMessageAt: new Date().toISOString() },
  { id: 'preview-2', title: '复刻这条视频', lastMessageAt: new Date().toISOString() },
];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url || String(input), window.location.href);
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  let body: unknown = [];
  if (url.pathname.includes('/credits/balance')) body = { balance: 100 };
  else if (url.pathname === '/api/mobile-chat/conversations' && method === 'GET') body = chats;
  else if (/\/api\/mobile-chat\/conversations\/[^/]+$/.test(url.pathname)) {
    const chat = chats.find((item) => item.id === url.pathname.split('/').pop());
    body = { ...(chat || chats[0]), messages: [] };
  } else if (url.pathname.endsWith('/messages') || method === 'POST') {
    return new Response(JSON.stringify({ message: '本地预览仅展示界面，请连接实际服务后发送消息。' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const previewUser = { id: 'preview', name: 'Wauuuu', phone: '13800000000', role: 'user' };
const startOnLogin = new URLSearchParams(window.location.search).get('screen') === 'login';
authApi.sendSms = async () => ({ ok: true });
useAuthStore.setState({
  user: startOnLogin ? null : previewUser,
  initializing: false,
  init: async () => {},
  loginWithSms: async () => { useAuthStore.setState({ user: previewUser }); },
  logout: async () => { useAuthStore.setState({ user: null }); },
});

const messages = new Map<string, MobileMessage[]>();
mobileChatApi.list = async () => chats;
mobileChatApi.create = async () => {
  const chat = { id: `preview-${Date.now()}`, title: '新对话', lastMessageAt: new Date().toISOString() };
  chats.unshift(chat);
  return chat;
};
mobileChatApi.get = async (id) => ({ ...(chats.find((chat) => chat.id === id) || chats[0]), messages: messages.get(id) || [] });
mobileChatApi.send = async (id, payload, onEvent) => {
  const now = new Date().toISOString();
  const userMessage: MobileMessage = { id: `user-${Date.now()}`, role: 'user', kind: 'text', content: payload.text, attachments: payload.attachments, jobId: null, status: 'done', createdAt: now };
  const response = '这是本地预览的模拟回复。你可以告诉我想创作什么，例如制作短视频、生成图片或设计商品详情页。';
  const reply: MobileMessage = { id: `assistant-${Date.now()}`, role: 'assistant', kind: 'text', content: response, attachments: [], jobId: null, status: 'done', createdAt: now };
  messages.set(id, [...(messages.get(id) || []), userMessage, reply]);
  const chat = chats.find((item) => item.id === id);
  if (chat && chat.title === '新对话') chat.title = payload.text.slice(0, 20) || '新对话';
  onEvent('status', { text: '思考中…' });
  await new Promise((resolve) => setTimeout(resolve, 450));
  onEvent('final', { message: reply });
};
createRoot(document.getElementById('root')!).render(<BrowserRouter><MobileApp /></BrowserRouter>);
