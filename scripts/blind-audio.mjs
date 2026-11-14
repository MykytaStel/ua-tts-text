#!/usr/bin/env node
/** Prepare and score a local, blinded A/B WAV listening study. */
import { createHash, randomBytes, randomInt as cryptoRandomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDY_FORMAT = 'ua-tts-blind-audio-study';
const PARTICIPANT_FORMAT = 'ua-tts-blind-audio-package';
const KEY_FORMAT = 'ua-tts-blind-audio-key';
const RESPONSES_FORMAT = 'ua-tts-blind-audio-responses';
const REPORT_FORMAT = 'ua-tts-blind-audio-report';
const PCM_GUID = '0100000000001000800000aa00389b71';
const FLOAT_GUID = '0300000000001000800000aa00389b71';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function addChunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Remove RIFF metadata while preserving the PCM/float format and audio payload. */
export function sanitizeWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('blind audio: expected a little-endian RIFF/WAVE file');
  const riffEnd = buffer.readUInt32LE(4) + 8;
  if (riffEnd < 12 || riffEnd > buffer.length) throw new Error('blind audio: WAV has an invalid RIFF size');

  let format;
  let data;
  let fact;
  let formatChunks = 0;
  let dataChunks = 0;
  let factChunks = 0;
  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new Error('blind audio: incomplete WAV chunk header');
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + size;
    const next = payloadEnd + (size % 2);
    if (payloadEnd > riffEnd || next > riffEnd) throw new Error(`blind audio: invalid WAV chunk size for "${id}"`);
    const payload = buffer.subarray(payloadStart, payloadEnd);
    if (id === 'fmt ') {
      formatChunks += 1;
      format = payload;
    } else if (id === 'data') {
      dataChunks += 1;
      data = payload;
    } else if (id === 'fact') {
      factChunks += 1;
      if (factChunks > 1 || payload.length < 4) throw new Error('blind audio: WAV has an invalid fact chunk');
      fact = payload.subarray(0, 4);
    }
    offset = next;
  }
  if (formatChunks !== 1 || dataChunks !== 1 || !format || !data || format.length < 16)
    throw new Error('blind audio: WAV must have exactly one fmt chunk and one data chunk');

  const formatTag = format.readUInt16LE(0);
  let audioEncoding = formatTag;
  let cleanFormat;
  if (formatTag === 0xfffe) {
    if (format.length < 40 || format.readUInt16LE(16) !== 22) throw new Error('blind audio: incomplete WAVE_FORMAT_EXTENSIBLE fmt chunk');
    const subformat = format.subarray(24, 40).toString('hex');
    audioEncoding = subformat === PCM_GUID ? 1 : subformat === FLOAT_GUID ? 3 : 0;
    cleanFormat = format.subarray(0, 40);
  } else {
    cleanFormat = format.subarray(0, 16);
  }
  if (audioEncoding !== 1 && audioEncoding !== 3)
    throw new Error('blind audio: only uncompressed PCM or IEEE-float WAV is supported for metadata removal');
  if (format.readUInt16LE(2) < 1 || format.readUInt32LE(4) < 1 || format.readUInt16LE(12) < 1 || format.readUInt16LE(14) < 1)
    throw new Error('blind audio: WAV fmt chunk has invalid channel, sample-rate, block-align, or bit-depth values');

  const chunks = [addChunk('fmt ', cleanFormat), ...(fact ? [addChunk('fact', fact)] : []), addChunk('data', data)];
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function readStudyFile(studyDirectory, relativeFile, label) {
  if (typeof relativeFile !== 'string' || relativeFile.length === 0 || path.isAbsolute(relativeFile))
    throw new Error(`blind audio: ${label} must be a relative path inside the study directory`);
  const lexicalPath = path.resolve(studyDirectory, relativeFile);
  if (!inside(studyDirectory, lexicalPath)) throw new Error(`blind audio: ${label} escapes the study directory`);
  let actualPath;
  try {
    actualPath = realpathSync(lexicalPath);
  } catch {
    throw new Error(`blind audio: ${label} does not exist: ${relativeFile}`);
  }
  if (!inside(studyDirectory, actualPath)) throw new Error(`blind audio: ${label} resolves outside the study directory`);
  if (!statSync(actualPath).isFile()) throw new Error(`blind audio: ${label} is not a file`);
  return { path: actualPath, bytes: readFileSync(actualPath) };
}

function validateManifest(manifest) {
  if (!isObject(manifest) || manifest.format !== STUDY_FORMAT || manifest.version !== 1)
    throw new Error(`blind audio: manifest must use ${STUDY_FORMAT} v1`);
  if (typeof manifest.studyId !== 'string' || !manifest.studyId.trim()) throw new Error('blind audio: studyId is required');
  if (typeof manifest.engine !== 'string' || !manifest.engine.trim()) throw new Error('blind audio: engine is required');
  if (typeof manifest.voiceModel !== 'string' || !manifest.voiceModel.trim()) throw new Error('blind audio: voiceModel is required');
  if (!Array.isArray(manifest.packageVersions) || manifest.packageVersions.length !== 2) throw new Error('blind audio: exactly two packageVersions are required');
  const versions = manifest.packageVersions;
  if (versions.some((version) => typeof version !== 'string' || !version.trim()) || new Set(versions).size !== 2)
    throw new Error('blind audio: packageVersions must be two distinct non-empty strings');
  if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) throw new Error('blind audio: at least one sample is required');
  if (manifest.settings !== undefined && !isObject(manifest.settings)) throw new Error('blind audio: settings must be an object');
  const sampleIds = new Set();
  for (const sample of manifest.samples) {
    if (!isObject(sample) || typeof sample.sampleId !== 'string' || !sample.sampleId.trim())
      throw new Error('blind audio: every sample needs a non-empty sampleId');
    if (sampleIds.has(sample.sampleId)) throw new Error(`blind audio: duplicate sampleId "${sample.sampleId}"`);
    sampleIds.add(sample.sampleId);
    if (typeof sample.text !== 'string' || !sample.text.trim()) throw new Error(`blind audio: sample "${sample.sampleId}" needs its transcript text`);
    if (!isObject(sample.audio) || Object.keys(sample.audio).length !== 2 || versions.some((version) => typeof sample.audio[version] !== 'string'))
      throw new Error(`blind audio: sample "${sample.sampleId}" must have one audio path for each package version`);
    if (sample.audio[versions[0]] === sample.audio[versions[1]])
      throw new Error(`blind audio: sample "${sample.sampleId}" must use two distinct audio files`);
    for (const version of versions) {
      if (path.extname(sample.audio[version]).toLowerCase() !== '.wav')
        throw new Error(`blind audio: sample "${sample.sampleId}" must use WAV files`);
    }
  }
  return versions;
}

function randomIndex(randomInt, max) {
  const value = randomInt(max);
  if (!Number.isInteger(value) || value < 0 || value >= max) throw new Error('blind audio: random source returned an invalid index');
  return value;
}

function shuffle(items, randomInt) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(randomInt, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Create participant materials and a separate organizer-only key. */
export async function prepareBlindStudy(manifestFile, outputDirectory, { randomInt = cryptoRandomInt } = {}) {
  const outputPath = path.resolve(outputDirectory);
  if (existsSync(outputPath)) throw new Error(`blind audio: output directory already exists: ${outputPath}`);
  const manifestPath = realpathSync(path.resolve(manifestFile));
  const manifestBytes = readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('blind audio: manifest is not valid JSON');
  }
  const versions = validateManifest(manifest);
  const studyDirectory = path.dirname(manifestPath);
  const randomized = shuffle(manifest.samples, randomInt);
  const aSideVersions = [
    ...Array(Math.floor(randomized.length / 2)).fill(versions[0]),
    ...Array(Math.floor(randomized.length / 2)).fill(versions[1]),
    ...(randomized.length % 2 ? [versions[randomIndex(randomInt, 2)]] : []),
  ];
  const randomizedASides = shuffle(aSideVersions, randomInt);
  const participantStudyId = `blind-${randomBytes(8).toString('hex')}`;

  let createdOutput = false;
  try {
    mkdirSync(outputPath);
    createdOutput = true;
    const participantDirectory = path.join(outputPath, 'participant');
    const audioDirectory = path.join(participantDirectory, 'audio');
    const organizerDirectory = path.join(outputPath, 'organizer');
    mkdirSync(participantDirectory, { mode: 0o700 });
    mkdirSync(audioDirectory, { recursive: true });
    mkdirSync(organizerDirectory, { mode: 0o700 });

    const participantSamples = [];
    const keySamples = [];
    for (const [index, sample] of randomized.entries()) {
      const blindSampleId = `sample-${String(index + 1).padStart(3, '0')}`;
      const sideAVersion = randomizedASides[index];
      const sideBVersion = versions.find((version) => version !== sideAVersion);
      const sampleAudioDirectory = path.join(audioDirectory, blindSampleId);
      mkdirSync(sampleAudioDirectory, { mode: 0o700 });
      const audioSha256 = {};
      const sanitizedAudio = {};
      const sourcePaths = new Set();
      for (const version of versions) {
        const source = readStudyFile(studyDirectory, sample.audio[version], `audio for ${sample.sampleId} (${version})`);
        if (sourcePaths.has(source.path)) throw new Error(`blind audio: sample "${sample.sampleId}" resolves both versions to the same WAV file`);
        sourcePaths.add(source.path);
        const original = source.bytes;
        audioSha256[version] = sha256(original);
        sanitizedAudio[version] = sanitizeWav(original);
      }
      const packagedAudioSha256 = {};
      for (const [side, version] of [['A', sideAVersion], ['B', sideBVersion]]) {
        const destination = path.join(sampleAudioDirectory, `${side}.wav`);
        writeFileSync(destination, sanitizedAudio[version], { flag: 'wx' });
        packagedAudioSha256[side] = sha256(sanitizedAudio[version]);
      }
      participantSamples.push({
        sampleId: blindSampleId,
        text: sample.text,
        audio: { A: `audio/${blindSampleId}/A.wav`, B: `audio/${blindSampleId}/B.wav` },
      });
      keySamples.push({
        blindSampleId,
        sourceSampleId: sample.sampleId,
        sourceSha256: sha256(Buffer.from(sample.text, 'utf8')),
        audioSha256,
        packagedAudioSha256,
        versionBySide: { A: sideAVersion, B: sideBVersion },
      });
    }

    const study = {
      format: PARTICIPANT_FORMAT,
      version: 1,
      studyId: participantStudyId,
      engine: manifest.engine,
      voiceModel: manifest.voiceModel,
      instructions: {
        task: 'Compare each audio pair against the transcript. Do not infer which package version produced a side.',
        scales: { stressCorrectness: '1 = incorrect stress, 5 = correct stress', naturalness: '1 = unnatural, 5 = natural' },
      },
      samples: participantSamples,
    };
    const responses = {
      format: RESPONSES_FORMAT,
      version: 1,
      studyId: participantStudyId,
      responses: participantSamples.map(({ sampleId }) => ({
        sampleId,
        preferredSide: null,
        stressCorrectness: { A: null, B: null },
        naturalness: { A: null, B: null },
        notes: '',
      })),
    };
    const key = {
      format: KEY_FORMAT,
      version: 1,
      studyId: manifest.studyId,
      participantStudyId,
      packageVersions: versions,
      engine: manifest.engine,
      voiceModel: manifest.voiceModel,
      settings: manifest.settings ?? {},
      manifestSha256: sha256(manifestBytes),
      randomization: 'sample order and a balanced A/B assignment were shuffled independently',
      samples: keySamples,
    };
    writeJson(path.join(participantDirectory, 'study.json'), study);
    writeJson(path.join(participantDirectory, 'responses.json'), responses);
    writeJson(path.join(organizerDirectory, 'key.json'), key);
    return {
      studyId: manifest.studyId,
      sampleCount: participantSamples.length,
      participantDirectory,
      keyPath: path.join(organizerDirectory, 'key.json'),
    };
  } catch (error) {
    if (createdOutput) rmSync(outputPath, { recursive: true, force: true });
    throw error;
  }
}

function validateKey(key) {
  if (!isObject(key) || key.format !== KEY_FORMAT || key.version !== 1 || typeof key.studyId !== 'string')
    throw new Error(`blind audio: key must use ${KEY_FORMAT} v1`);
  if (typeof key.participantStudyId !== 'string' || !/^blind-[a-f0-9]{16}$/u.test(key.participantStudyId))
    throw new Error('blind audio: key has an invalid participant study ID');
  if (!Array.isArray(key.packageVersions) || key.packageVersions.length !== 2 || new Set(key.packageVersions).size !== 2)
    throw new Error('blind audio: key must contain two package versions');
  if (!Array.isArray(key.samples) || key.samples.length === 0) throw new Error('blind audio: key has no samples');
  const ids = new Set();
  for (const sample of key.samples) {
    if (!isObject(sample) || typeof sample.blindSampleId !== 'string' || ids.has(sample.blindSampleId))
      throw new Error('blind audio: key has an invalid or duplicate blind sample ID');
    ids.add(sample.blindSampleId);
    if (!isObject(sample.versionBySide) || !key.packageVersions.includes(sample.versionBySide.A) || !key.packageVersions.includes(sample.versionBySide.B) || sample.versionBySide.A === sample.versionBySide.B)
      throw new Error(`blind audio: key has an invalid version mapping for ${sample.blindSampleId}`);
  }
}

function assertRating(value, field, sampleId) {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`blind audio: ${field} for ${sampleId} must be an integer from 1 to 5`);
}

/** Validate a completed response sheet and produce descriptive per-version aggregates. */
export function scoreBlindStudy(keyFile, responsesFile) {
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  const responses = JSON.parse(readFileSync(responsesFile, 'utf8'));
  validateKey(key);
  if (!isObject(responses) || responses.format !== RESPONSES_FORMAT || responses.version !== 1 || responses.studyId !== key.participantStudyId || !Array.isArray(responses.responses))
    throw new Error('blind audio: response file does not match the organizer key');
  if (responses.responses.length !== key.samples.length) throw new Error('blind audio: responses must include every blind sample exactly once');
  const keyById = new Map(key.samples.map((sample) => [sample.blindSampleId, sample]));
  const seen = new Set();
  const accumulators = Object.fromEntries(key.packageVersions.map((version) => [version, { preferenceWins: 0, stressCorrectness: [], naturalness: [] }]));
  let ties = 0;
  const sampleResults = [];
  for (const response of responses.responses) {
    if (!isObject(response) || typeof response.sampleId !== 'string' || seen.has(response.sampleId) || !keyById.has(response.sampleId))
      throw new Error('blind audio: responses must include every blind sample exactly once');
    seen.add(response.sampleId);
    const sample = keyById.get(response.sampleId);
    if (!['A', 'B', 'tie'].includes(response.preferredSide))
      throw new Error(`blind audio: preferredSide for ${response.sampleId} must be A, B, or tie`);
    for (const rating of ['stressCorrectness', 'naturalness']) {
      if (!isObject(response[rating])) throw new Error(`blind audio: ${rating} ratings are missing for ${response.sampleId}`);
      assertRating(response[rating].A, `${rating}.A`, response.sampleId);
      assertRating(response[rating].B, `${rating}.B`, response.sampleId);
    }
    if (typeof response.notes !== 'string') throw new Error(`blind audio: notes for ${response.sampleId} must be a string`);
    for (const side of ['A', 'B']) {
      const version = sample.versionBySide[side];
      accumulators[version].stressCorrectness.push(response.stressCorrectness[side]);
      accumulators[version].naturalness.push(response.naturalness[side]);
      if (response.preferredSide === side) accumulators[version].preferenceWins += 1;
    }
    if (response.preferredSide === 'tie') ties += 1;
    sampleResults.push({
      blindSampleId: sample.blindSampleId,
      sampleId: sample.sourceSampleId,
      sourceSha256: sample.sourceSha256,
      versionBySide: sample.versionBySide,
      preferredVersion: response.preferredSide === 'tie' ? 'tie' : sample.versionBySide[response.preferredSide],
      stressCorrectnessByVersion: Object.fromEntries(['A', 'B'].map((side) => [sample.versionBySide[side], response.stressCorrectness[side]])),
      naturalnessByVersion: Object.fromEntries(['A', 'B'].map((side) => [sample.versionBySide[side], response.naturalness[side]])),
      notes: response.notes,
    });
  }
  if (seen.size !== key.samples.length) throw new Error('blind audio: responses must include every blind sample exactly once');
  const mean = (values) => Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  return {
    format: REPORT_FORMAT,
    version: 1,
    studyId: key.studyId,
    packageVersions: key.packageVersions,
    engine: key.engine,
    voiceModel: key.voiceModel,
    settings: key.settings,
    manifestSha256: key.manifestSha256,
    sampleCount: key.samples.length,
    samples: sampleResults,
    preference: {
      winsByVersion: Object.fromEntries(key.packageVersions.map((version) => [version, accumulators[version].preferenceWins])),
      ties,
    },
    scoresByVersion: Object.fromEntries(
      key.packageVersions.map((version) => [
        version,
        {
          preferenceWins: accumulators[version].preferenceWins,
          averageStressCorrectness: mean(accumulators[version].stressCorrectness),
          averageNaturalness: mean(accumulators[version].naturalness),
        },
      ]),
    ),
    interpretation: 'Descriptive ratings from this study only; no significance or broad quality claim is inferred.',
  };
}

function optionsFrom(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name?.startsWith('--') || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`blind audio: expected a value after ${name}`);
    const key = name.slice(2);
    if (!['manifest', 'outdir', 'key', 'responses', 'out'].includes(key)) throw new Error(`blind audio: unknown option ${name}`);
    if (options[key] !== undefined) throw new Error(`blind audio: duplicate option ${name}`);
    options[key] = args[index + 1];
    index += 1;
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/blind-audio.mjs prepare --manifest study.json --outdir blind-study',
    '  node scripts/blind-audio.mjs score --key blind-study/organizer/key.json --responses blind-study/participant/responses.json [--out report.json]',
    '',
    'prepare requires two versioned PCM/float WAV files per sample. Share only the participant/ directory; keep organizer/key.json private.',
  ].join('\n');
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || !command) {
    console.log(usage());
    return;
  }
  const options = optionsFrom(rest);
  if (command === 'prepare') {
    if (!options.manifest || !options.outdir || options.key || options.responses || options.out) throw new Error('blind audio: prepare needs --manifest and --outdir only');
    console.log(JSON.stringify(await prepareBlindStudy(options.manifest, options.outdir), null, 2));
    return;
  }
  if (command === 'score') {
    if (!options.key || !options.responses || options.manifest || options.outdir) throw new Error('blind audio: score needs --key and --responses');
    const report = scoreBlindStudy(options.key, options.responses);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out) writeFileSync(path.resolve(options.out), serialized, { flag: 'wx' });
    else process.stdout.write(serialized);
    return;
  }
  throw new Error(`blind audio: unknown command "${command}"\n${usage()}`);
}

let directExecution = false;
if (process.argv[1]) {
  try {
    directExecution = realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    directExecution = false;
  }
}

if (directExecution) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`blind audio: ${error.message}`);
    process.exitCode = 1;
  });
}
