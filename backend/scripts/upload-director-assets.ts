import { ConfigService } from '@nestjs/config';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { OssService } from '../src/oss/oss.service';

const ASSET_SOURCE_DIR = path.resolve(__dirname, '../../frontend/public/director/open-source');
const REMOTE_PREFIX = 'director-assets/v1/open-source';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const CONTENT_TYPES: Record<string, string> = {
  '.bin': 'application/octet-stream',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.splat': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  }));
  return nested.flat().sort();
}

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });

  const oss = new OssService(new ConfigService(process.env));
  if (!oss.isEnabled()) throw new Error('OSS/TOS is not configured');

  const files = await listFiles(ASSET_SOURCE_DIR);
  let uploadedBytes = 0;

  for (const absolutePath of files) {
    const relativePath = path.relative(ASSET_SOURCE_DIR, absolutePath).split(path.sep).join('/');
    const key = `${REMOTE_PREFIX}/${relativePath}`;
    const body = await fs.readFile(absolutePath);
    const contentType = CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream';
    const sha256 = createHash('sha256').update(body).digest('hex');

    await oss.putBufferWithHeaders(key, body, contentType, {
      'Cache-Control': CACHE_CONTROL,
      'x-tanva-sha256': sha256,
    });
    uploadedBytes += body.byteLength;
    console.log(`uploaded ${relativePath} (${body.byteLength} bytes)`);
  }

  console.log(`uploaded ${files.length} files / ${uploadedBytes} bytes`);
  console.log(`public base: ${oss.publicUrl(REMOTE_PREFIX)}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
