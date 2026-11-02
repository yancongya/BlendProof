import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'landing', 'index.html');
const outputRoot = path.join(root, 'landing', 'assets', 'optimized');
const cardOutputRoot = path.join(outputRoot, 'cards');
const cardWidths = [512, 768];
const cardQuality = 84;
const splashQuality = 84;
const cardOutputBudgets = new Map([[512, 700_000], [768, 1_300_000]]);
const splashOutputBudget = 100_000;

async function existingFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function sourceBytes(filePath) {
  return (await stat(filePath)).size;
}

async function findCardSource(basename) {
  const sourceDirs = [
    { dir: path.join(root, 'public', 'landing'), label: 'public/landing' },
    { dir: path.join(root, 'landing', 'assets', 'cards'), label: 'landing/assets/cards fallback' },
  ];
  const extensions = ['png', 'jpg', 'jpeg'];

  for (const { dir, label } of sourceDirs) {
    for (const extension of extensions) {
      const filePath = path.join(dir, `${basename}.${extension}`);
      if (await existingFile(filePath)) return { filePath, label };
    }
  }

  throw new Error(`No original PNG/JPEG source found for ${basename} in public/landing or landing/assets/cards.`);
}

function assertAlphaPreserved(sourceMetadata, outputMetadata, label) {
  if (Boolean(sourceMetadata.hasAlpha) !== Boolean(outputMetadata.hasAlpha)) {
    throw new Error(`Alpha channel changed while optimizing ${label}.`);
  }
}

async function assertAlphaPixelsPreserved(sourcePath, outputPath, width, sourceMetadata) {
  if (!sourceMetadata.hasAlpha) return;
  const [sourceAlpha, outputAlpha] = await Promise.all([
    sharp(sourcePath).resize({ width }).ensureAlpha().extractChannel(3).raw().toBuffer(),
    sharp(outputPath).ensureAlpha().extractChannel(3).raw().toBuffer(),
  ]);
  if (!sourceAlpha.equals(outputAlpha)) {
    throw new Error(`Alpha channel pixel values changed while optimizing ${outputPath}.`);
  }
}

async function optimizeCard(basename) {
  const { filePath, label } = await findCardSource(basename);
  const sourceMetadata = await sharp(filePath).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height || sourceMetadata.width < Math.max(...cardWidths)) {
    throw new Error(`Card source must be at least ${Math.max(...cardWidths)}px wide: ${filePath}`);
  }

  const outputs = [];
  for (const width of cardWidths) {
    const outputPath = path.join(cardOutputRoot, `${basename}-${width}.webp`);
    await sharp(filePath)
      .resize({ width })
      .webp({ quality: cardQuality, alphaQuality: 100, effort: 6 })
      .toFile(outputPath);

    const outputMetadata = await sharp(outputPath).metadata();
    const expectedHeight = Math.round(sourceMetadata.height * width / sourceMetadata.width);
    if (outputMetadata.format !== 'webp' || outputMetadata.width !== width || outputMetadata.height !== expectedHeight) {
      throw new Error(`Unexpected optimized card output: ${outputPath}`);
    }
    assertAlphaPreserved(sourceMetadata, outputMetadata, outputPath);
    await assertAlphaPixelsPreserved(filePath, outputPath, width, sourceMetadata);
    if ((await sourceBytes(outputPath)) >= (await sourceBytes(filePath))) {
      throw new Error(`Optimized card output is not smaller than its source: ${outputPath}`);
    }
    outputs.push({ path: path.relative(root, outputPath), bytes: await sourceBytes(outputPath) });
  }

  return {
    kind: 'card',
    source: path.relative(root, filePath),
    sourceKind: label,
    sourceBytes: await sourceBytes(filePath),
    outputs,
  };
}

async function optimizeSplash(html) {
  const splashReferences = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => tag.match(/\bdata-optimization-source\s*=\s*["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
  const uniqueSplashReferences = [...new Set(splashReferences)];
  if (uniqueSplashReferences.length !== 1) {
    throw new Error(`Expected one data-optimization-source in landing/index.html; found ${uniqueSplashReferences.length}.`);
  }

  const sourcePath = path.resolve(path.dirname(htmlPath), uniqueSplashReferences[0]);
  const publicRoot = path.join(root, 'public');
  const pathFromPublic = path.relative(publicRoot, sourcePath);
  if (pathFromPublic.startsWith('..') || path.isAbsolute(pathFromPublic)) {
    throw new Error(`Splash data-optimization-source must resolve within public/: ${uniqueSplashReferences[0]}`);
  }
  if (!(await existingFile(sourcePath))) throw new Error(`Splash source does not exist: ${sourcePath}`);

  const sourceMetadata = await sharp(sourcePath).metadata();
  const outputPath = path.join(outputRoot, 'blendproof-splash.webp');
  await sharp(sourcePath)
    .webp({ quality: splashQuality, effort: 6 })
    .toFile(outputPath);

  const outputMetadata = await sharp(outputPath).metadata();
  if (outputMetadata.format !== 'webp' || outputMetadata.width !== sourceMetadata.width || outputMetadata.height !== sourceMetadata.height) {
    throw new Error(`Unexpected optimized splash output: ${outputPath}`);
  }
  assertAlphaPreserved(sourceMetadata, outputMetadata, outputPath);

  return {
    kind: 'splash',
    source: path.relative(root, sourcePath),
    sourceKind: 'public splash source from data-optimization-source',
    sourceBytes: await sourceBytes(sourcePath),
    outputs: [{ path: path.relative(root, outputPath), bytes: await sourceBytes(outputPath) }],
  };
}

const html = (await readFile(htmlPath, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
const cardTags = [...html.matchAll(/<img\b[^>]*>/gi)]
  .map(([tag]) => tag)
  .filter((tag) => /\.\/assets\/optimized\/cards\//i.test(tag));
if (cardTags.length !== 19) {
  throw new Error(`Expected 19 optimized card images in landing/index.html; found ${cardTags.length}.`);
}

const cardBasenames = new Set();
for (const tag of cardTags) {
  const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
  const srcset = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
  const fallback = src.match(/^\.\/assets\/optimized\/cards\/([^/?#]+)-(512|768)\.webp$/i);
  const candidates = srcset.split(',').map((candidate) => {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    return { url, descriptor };
  });
  const byWidth = new Map(candidates.map(({ url, descriptor }) => [descriptor, url]));
  if (fallback?.[2] !== '512' || candidates.length !== 2 || byWidth.size !== 2 ||
      byWidth.get('512w') !== src ||
      byWidth.get('768w') !== `./assets/optimized/cards/${fallback[1]}-768.webp`) {
    throw new Error(`Invalid 512/768 card srcset pairing: ${tag}`);
  }
  cardBasenames.add(fallback[1]);
}

await mkdir(cardOutputRoot, { recursive: true });
const results = [];
for (const basename of cardBasenames) results.push(await optimizeCard(basename));
results.push(await optimizeSplash(html));

const cardResults = results.filter((result) => result.kind === 'card');
const splashResult = results.find((result) => result.kind === 'splash');
const cardOutputs = cardResults.flatMap((result) => result.outputs);
const cardSourceTotal = cardResults.reduce((total, result) => total + result.sourceBytes, 0);
const cardOutputTotal = cardOutputs.reduce((total, output) => total + output.bytes, 0);
const splashOutput = splashResult.outputs[0];
const allOutputTotal = cardOutputTotal + splashOutput.bytes;
for (const width of cardWidths) {
  const widthTotal = cardOutputs
    .filter((output) => output.path.endsWith(`-${width}.webp`))
    .reduce((total, output) => total + output.bytes, 0);
  if (widthTotal > cardOutputBudgets.get(width)) {
    throw new Error(`Card ${width}w output budget exceeded: ${widthTotal} > ${cardOutputBudgets.get(width)} B.`);
  }
}
if (splashOutput.bytes > splashOutputBudget) {
  throw new Error(`Splash output budget exceeded: ${splashOutput.bytes} > ${splashOutputBudget} B.`);
}

for (const result of results) {
  const outputs = result.outputs.map((output) => `${output.path} ${output.bytes} B`).join('; ');
  console.log(`${result.source} (${result.sourceKind}, ${result.sourceBytes} B) -> ${outputs}`);
}

for (const width of cardWidths) {
  const candidates = cardOutputs.filter((output) => output.path.endsWith(`-${width}.webp`));
  const bytes = candidates.reduce((total, output) => total + output.bytes, 0);
  console.log(`Card ${width}w candidates: ${candidates.length} files; ${bytes} B total.`);
}

console.log(`Unique sources: ${results.length} total (${cardResults.length} cards + 1 splash).`);
console.log(`Card source total: ${cardResults.length} files; ${cardSourceTotal} B.`);
console.log(`Card outputs: ${cardOutputs.length} files; ${cardOutputTotal} B across both candidate widths.`);
console.log(`Splash: ${splashResult.sourceBytes} B source -> ${splashOutput.bytes} B WebP.`);
console.log(`All optimized outputs: ${cardOutputs.length + 1} files; ${allOutputTotal} B.`);
