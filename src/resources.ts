/** Shared, immutable resource snapshots for CLI and integrations. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextRules } from './context.js';
import { StressDictionary } from './dict.js';
import { Lexicon } from './lexicon.js';
import { NormalizationRules } from './normalization-rules.js';

export interface ResourceOptions {
  home?: string;
  dictionaryPath?: string;
  lexiconPath?: string;
  normalizationPath?: string;
  packageRoot?: string;
  /** Fail closed when the dictionary is absent. */
  required?: boolean;
}
export interface ResourceManifest {
  readonly version: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
  readonly fingerprint: string;
  readonly dictionary?: {
    readonly sha256: string;
    readonly sourceVerified: boolean;
    readonly sourceCommit?: string;
    readonly sourceSha256?: string;
  };
}
export interface Resources {
  readonly dictionary?: StressDictionary;
  readonly lexicon: Lexicon;
  readonly context: ContextRules;
  /** Optional on user-created snapshots for backwards compatibility; loadResources always provides it. */
  readonly normalization?: NormalizationRules;
  readonly manifest: ResourceManifest;
}
export interface LoadedResources extends Resources {
  readonly normalization: NormalizationRules;
}
let cached: { key: string; resources: LoadedResources } | undefined;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Bundled defaults + local overrides, read and hashed as one stable snapshot. */
export function loadResources(options: ResourceOptions = {}): LoadedResources {
  const root = options.packageRoot ?? fileURLToPath(new URL('..', import.meta.url));
  const home = options.home ?? process.env['UA_TTS_HOME'] ?? path.join(homedir(), '.local/share/ua-tts-text');
  const dict = path.resolve(
    options.dictionaryPath ??
      process.env['UA_TTS_DICT'] ??
      [path.join(home, 'dict.bin'), path.join(root, 'data/dict.bin')].find(existsSync) ??
      path.join(home, 'dict.bin'),
  );
  if (options.required && !existsSync(dict)) throw new Error(`ua-tts-text: dictionary missing: ${dict}`);
  const names = path.resolve(options.lexiconPath ?? process.env['UA_TTS_LEXICON'] ?? path.join(home, 'names.tsv'));
  if ((options.lexiconPath || process.env['UA_TTS_LEXICON']) && !existsSync(names))
    throw new Error(`ua-tts-text: lexicon missing: ${names}`);
  const normalizationPath = path.resolve(
    options.normalizationPath ?? process.env['UA_TTS_NORMALIZATION'] ?? path.join(home, 'normalization.tsv'),
  );
  if ((options.normalizationPath || process.env['UA_TTS_NORMALIZATION']) && !existsSync(normalizationPath))
    throw new Error(`ua-tts-text: normalization rules missing: ${normalizationPath}`);

  const unique = (files: string[]) => [...new Set(files.map((file) => path.resolve(file)))].filter(existsSync);
  const lexicons = unique([
    path.join(root, 'lexicon/common.tsv'),
    path.join(root, 'lexicon/names.tsv'),
    path.join(path.dirname(names), 'common.tsv'),
    names,
  ]);
  const contexts = unique([path.join(path.dirname(names), 'context.tsv'), path.join(root, 'lexicon/context.tsv')]);
  const normalizationFiles = unique([path.join(root, 'lexicon/normalization.tsv'), normalizationPath]);
  const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
  const runtimeFiles = readdirSync(runtimeDirectory)
    .filter((file) => /\.(?:js|ts)$/u.test(file))
    .sort()
    .map((file) => path.join(runtimeDirectory, file));
  const dictionaryManifest = existsSync(dict) ? path.join(path.dirname(dict), 'dict.manifest.json') : undefined;
  const files = unique([
    path.join(root, 'package.json'),
    dict,
    ...(dictionaryManifest ? [dictionaryManifest] : []),
    ...lexicons,
    ...contexts,
    ...normalizationFiles,
    ...runtimeFiles,
  ]);
  const fileState = files.map((file) => {
    const stat = statSync(file);
    return [file, stat.size, stat.mtimeMs, stat.ctimeMs];
  });
  const key = JSON.stringify({ dict, lexicons, contexts, normalizationFiles, fileState });
  if (cached?.key === key) return cached.resources;

  // Parse the exact bytes whose hashes enter the manifest; no later file read can mix versions.
  const snapshots = new Map(files.map((file) => [file, readFileSync(file)]));
  const stateAfterRead = files.map((file) => {
    const stat = statSync(file);
    return [file, stat.size, stat.mtimeMs, stat.ctimeMs];
  });
  if (JSON.stringify(stateAfterRead) !== JSON.stringify(fileState))
    throw new Error('ua-tts-text: resources changed while loading; retry the operation to get a consistent snapshot');
  const entries = files.map((file) => Object.freeze({ path: file, sha256: hash(snapshots.get(file)!) }));
  const packageJson = JSON.parse(snapshots.get(path.join(root, 'package.json'))!.toString('utf8')) as { version: string };
  if (typeof packageJson.version !== 'string' || !packageJson.version)
    throw new Error(`ua-tts-text: invalid package version in ${path.join(root, 'package.json')}`);

  const lexicon = new Lexicon();
  for (const file of lexicons) lexicon.merge(Lexicon.parseTsv(snapshots.get(file)!.toString('utf8'), file));
  const context = new ContextRules();
  for (const file of contexts) context.addTsv(snapshots.get(file)!.toString('utf8'), file);
  const normalization = new NormalizationRules();
  for (const file of normalizationFiles) normalization.merge(NormalizationRules.parseTsv(snapshots.get(file)!.toString('utf8'), file));

  const dictionaryBytes = snapshots.get(dict);
  const dictionarySha256 = dictionaryBytes ? hash(dictionaryBytes) : undefined;
  const dictionaryMetadataBytes = dictionaryManifest ? snapshots.get(dictionaryManifest) : undefined;
  const dictionaryMetadata = dictionaryMetadataBytes
    ? (JSON.parse(dictionaryMetadataBytes.toString('utf8')) as {
        binarySha256?: string;
        binaryFormat?: number;
        commit?: string;
        sha256?: string;
      })
    : undefined;
  if (dictionaryMetadata && dictionaryMetadata.binarySha256 !== dictionarySha256)
    throw new Error(`ua-tts-text: dictionary manifest does not match the loaded binary: ${dict}`);

  const fingerprint = hash(
    JSON.stringify({ version: packageJson.version, files: entries.map((file) => file.sha256), dictionary: snapshots.has(dict) }),
  );
  const manifest = Object.freeze({
    version: packageJson.version,
    files: Object.freeze(entries),
    fingerprint,
    ...(dictionarySha256
      ? {
          dictionary: Object.freeze({
            sha256: dictionarySha256,
            sourceVerified:
              dictionaryMetadata?.binarySha256 === dictionarySha256 &&
              dictionaryMetadata.binaryFormat === 3 &&
              typeof dictionaryMetadata.commit === 'string' &&
              typeof dictionaryMetadata.sha256 === 'string',
            ...(dictionaryMetadata?.commit ? { sourceCommit: dictionaryMetadata.commit } : {}),
            ...(dictionaryMetadata?.sha256 ? { sourceSha256: dictionaryMetadata.sha256 } : {}),
          }),
        }
      : {}),
  });
  const resources: LoadedResources = Object.freeze({
    ...(snapshots.has(dict) ? { dictionary: StressDictionary.loadBuffer(snapshots.get(dict)!) } : {}),
    lexicon: lexicon.seal(),
    context: context.seal(),
    normalization: normalization.seal(),
    manifest,
  });
  cached = { key, resources };
  return resources;
}

export function resetResourceCache(): void {
  cached = undefined;
}
