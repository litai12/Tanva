#!/usr/bin/env node
/**
 * Stage the reference desktop runtime into the Electron bundle slot.
 *
 * The reference executable is user supplied. This script intentionally keeps
 * the source path explicit and never downloads or invents a runtime. It copies
 * only Settings/IsolatedPython, Settings/IsolatedNode and Settings/Skills,
 * while skipping Python generated caches. Use --dry-run first, then --force to replace
 * an existing staged bundle.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const sourceRoot = resolve(valueAfter('--source') || process.env.JZXZ_SOURCE_ROOT || '');
const destinationRoot = resolve(valueAfter('--destination') || join(process.cwd(), 'desktop-bundle'));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!sourceRoot || sourceRoot === resolve('.')) {
  console.error('用法：node scripts/importDesktopBundle.mjs --source /path/to/reference/app [--dry-run] [--force]');
  process.exit(2);
}

const sourceSettings = join(sourceRoot, 'Settings');
const sourceSkills = join(sourceSettings, 'Skills');
const sourcePython = join(sourceSettings, 'IsolatedPython');
const sourceNode = join(sourceSettings, 'IsolatedNode');

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const countFiles = async (root) => {
  let files = 0;
  let bytes = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        files += 1;
        bytes += (await stat(path)).size;
      }
    }
  };
  await walk(root);
  return { files, bytes };
};

if (!(await exists(sourceSkills))) {
  console.error(`参考目录缺少 Settings/Skills：${sourceSkills}`);
  process.exit(1);
}

const sourceCandidates = [sourcePython, sourceNode, sourceSkills];
const sourcePresence = await Promise.all(sourceCandidates.map((path) => exists(path)));
const sources = sourceCandidates.filter((_path, index) => sourcePresence[index]);
const summaries = await Promise.all(sources.map(async (source) => ({
  name: basename(source),
  ...(await countFiles(source)),
})));
const totalFiles = summaries.reduce((sum, item) => sum + item.files, 0);
const totalBytes = summaries.reduce((sum, item) => sum + item.bytes, 0);
console.log(`准备导入 ${totalFiles} 个文件（${(totalBytes / 1024 / 1024).toFixed(1)} MiB）`);
for (const item of summaries) console.log(`- ${item.name}: ${item.files} 个文件`);

if (dryRun) process.exit(0);
if (await exists(destinationRoot) && (await readdir(destinationRoot)).length > 0 && !force) {
  console.error(`目标目录非空：${destinationRoot}；如确认替换请加 --force`);
  process.exit(1);
}

if (force && await exists(destinationRoot)) await rm(destinationRoot, { recursive: true, force: true });
await mkdir(destinationRoot, { recursive: true });
const settingsDestination = join(destinationRoot, 'Settings');
for (const source of sources) {
  const destination = join(settingsDestination, basename(source));
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const name = basename(sourcePath);
      return name !== '__pycache__' && !name.endsWith('.pyc');
    },
  });
}

let referenceVersion = null;
const versionPath = join(sourceRoot, 'version.txt');
if (await exists(versionPath)) referenceVersion = (await readFile(versionPath, 'utf8')).trim();
const manifest = {
  format: 1,
  importedFrom: 'user-supplied-reference-app',
  referenceVersion,
  runtime: {
    python: 'Settings/IsolatedPython/python.exe',
    node: 'Settings/IsolatedNode/node.exe',
  },
  skillsRoot: 'Settings/Skills',
  connectors: ['sketchup', 'rhino', 'grasshopper', 'autocad', 'photoshop', '3dsmax', 'revit', 'illustrator', 'indesign', 'windows'],
  files: totalFiles,
  bytes: totalBytes,
};
await writeFile(join(destinationRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`已写入 ${destinationRoot}`);
