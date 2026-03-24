#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_URL = 'https://cloud.tencent.com/document/product/862/129151';
const OUTPUT_FILE = resolve(
  process.cwd(),
  'src/components/flow/nodes/tencentSystemVoices.ts',
);

const LANGUAGE_CODE_MAP = {
  中文: 'zh',
  粤语: 'yue',
  英语: 'en',
  日语: 'ja',
  韩语: 'ko',
  德语: 'de',
  俄语: 'ru',
  意大利语: 'it',
  西班牙语: 'es',
  葡萄牙语: 'pt',
  法语: 'fr',
  印尼语: 'id',
  荷兰语: 'nl',
  越南语: 'vi',
  阿拉伯语: 'ar',
  土耳其语: 'tr',
  乌克兰语: 'uk',
};

function unescapeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function extractVoiceRows(html) {
  const rows = [];
  const rowRegex = /<tr data-slate-node="element" class="">([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const values = [];
    const textRegex = /<span data-slate-string="true">([\s\S]*?)<\/span>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(rowHtml))) {
      const text = unescapeHtml(textMatch[1]).replace(/﻿/g, '').trim();
      if (text) values.push(text);
    }

    if (values.length >= 7 && /^\d+$/.test(values[0]) && values[6].startsWith('s1_')) {
      rows.push({
        index: Number(values[0]),
        genderZh: values[1],
        ageZh: values[2],
        langZh: values[3],
        nameZh: values[4],
        sampleLabel: values[5],
        voiceId: values[6],
      });
    }
  }

  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => ({
    ...row,
    langCode: LANGUAGE_CODE_MAP[row.langZh] || 'other',
    gender: row.genderZh === '女性' ? 'female' : 'male',
  }));
}

function renderVoicesTs(voices) {
  const header = `/*
 * Generated from Tencent Cloud MPS system voice page:
 * ${SOURCE_URL}
 * Updated by script on ${new Date().toISOString()}
 */

`;
  const typeDef = `export type TencentSystemVoice = {
  index: number;
  voiceId: string;
  langCode: string;
  langZh: string;
  gender: 'male' | 'female';
  genderZh: string;
  ageZh: string;
  nameZh: string;
  sampleLabel: string;
};

`;
  return `${header}${typeDef}export const TENCENT_SYSTEM_VOICES: TencentSystemVoice[] = ${JSON.stringify(
    voices,
    null,
    2,
  )};
`;
}

async function main() {
  const response = await fetch(SOURCE_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const voices = extractVoiceRows(html);
  if (voices.length === 0) {
    throw new Error('No voices extracted from source HTML.');
  }
  writeFileSync(OUTPUT_FILE, renderVoicesTs(voices), 'utf8');
  console.log(`Synced ${voices.length} voices -> ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error('[syncTencentSystemVoices] failed:', error);
  process.exit(1);
});

