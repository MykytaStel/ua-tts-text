import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareBlindStudy, sanitizeWav, scoreBlindStudy } from './blind-audio.mjs';

const blindAudioScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blind-audio.mjs');

function chunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function makeWav(sample, tag) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(16000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const metadata = Buffer.concat([Buffer.from('INFO'), chunk('INAM', Buffer.from(tag, 'ascii'))]);
  const fact = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(`extra-${tag}`, 'ascii')]);
  const body = Buffer.concat([chunk('fmt ', format), chunk('LIST', metadata), chunk('fact', fact), chunk('data', Buffer.from([sample, 0]))]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function wavChunks(buffer) {
  const ids = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    ids.push(buffer.toString('ascii', offset, offset + 4));
    offset += 8 + size + (size % 2);
  }
  return ids;
}

function wavChunkPayload(buffer, targetId) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === targetId) return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return null;
}

test('prepares a blinded balanced WAV set and scores responses through the hidden key', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ua-tts-blind-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'old'));
  mkdirSync(path.join(root, 'new'));
  const samples = ['s1', 's2', 's3'].map((sampleId, index) => {
    const oldPath = path.join(root, 'old', `${sampleId}.wav`);
    const newPath = path.join(root, 'new', `${sampleId}.wav`);
    writeFileSync(oldPath, makeWav(index + 1, `release-0.15.0-${sampleId}`));
    writeFileSync(newPath, makeWav(index + 11, `release-0.16.0-${sampleId}`));
    return {
      sampleId,
      text: `Тестове речення ${index + 1}.`,
      audio: { '0.15.0': `old/${sampleId}.wav`, '0.16.0': `new/${sampleId}.wav` },
    };
  });
  const manifestPath = path.join(root, 'study.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      format: 'ua-tts-blind-audio-study',
      version: 1,
      studyId: 'holdout-016',
      engine: 'tts-uk',
      voiceModel: 'test-voice',
      settings: { rate: 1 },
      packageVersions: ['0.15.0', '0.16.0'],
      samples,
    }),
  );

  const outputDir = path.join(root, 'output');
  const prepared = await prepareBlindStudy(manifestPath, outputDir, { randomInt: () => 0 });
  const participant = JSON.parse(readFileSync(path.join(outputDir, 'participant', 'study.json'), 'utf8'));
  const key = JSON.parse(readFileSync(prepared.keyPath, 'utf8'));

  assert.equal(participant.samples.length, 3);
  assert.match(participant.studyId, /^blind-[a-f0-9]{16}$/u);
  assert.equal(participant.packageVersions, undefined);
  assert.equal(JSON.stringify(participant).includes('0.15.0'), false);
  assert.equal(JSON.stringify(participant).includes('0.16.0'), false);
  const sideACount = key.samples.filter((item) => item.versionBySide.A === '0.15.0').length;
  assert.ok(Math.abs(sideACount - (key.samples.length - sideACount)) <= 1);
  assert.notDeepEqual(key.samples.map((item) => item.sourceSampleId), ['s1', 's2', 's3']);
  for (const sample of participant.samples) {
    const mapping = key.samples.find((item) => item.blindSampleId === sample.sampleId);
    for (const side of ['A', 'B']) {
      const audio = readFileSync(path.join(outputDir, 'participant', sample.audio[side]));
      const version = mapping.versionBySide[side];
      const source = samples.find((item) => item.sampleId === mapping.sourceSampleId);
      const original = readFileSync(path.join(root, source.audio[version]));
      assert.deepEqual(wavChunks(audio), ['fmt ', 'fact', 'data']);
      assert.deepEqual(wavChunkPayload(audio, 'data'), wavChunkPayload(original, 'data'));
      assert.equal(wavChunkPayload(audio, 'fact').length, 4);
      assert.equal(audio.includes(Buffer.from('release-0.15.0')), false);
      assert.equal(audio.includes(Buffer.from('release-0.16.0')), false);
      assert.equal(createHash('sha256').update(audio).digest('hex'), mapping.packagedAudioSha256[side]);
    }
  }

  const responsesPath = path.join(outputDir, 'participant', 'responses.json');
  const responses = JSON.parse(readFileSync(responsesPath, 'utf8'));
  for (const response of responses.responses) {
    const mapping = key.samples.find((item) => item.blindSampleId === response.sampleId).versionBySide;
    response.preferredSide = mapping.A === '0.16.0' ? 'A' : 'B';
    response.stressCorrectness = { A: mapping.A === '0.16.0' ? 5 : 3, B: mapping.B === '0.16.0' ? 5 : 3 };
    response.naturalness = { A: mapping.A === '0.16.0' ? 4 : 2, B: mapping.B === '0.16.0' ? 4 : 2 };
  }
  writeFileSync(responsesPath, `${JSON.stringify(responses, null, 2)}\n`);

  const report = await scoreBlindStudy(prepared.keyPath, responsesPath);
  assert.equal(report.sampleCount, 3);
  assert.equal(report.samples.length, 3);
  assert.ok(report.samples.every((sample) => sample.preferredVersion === '0.16.0'));
  assert.equal(report.scoresByVersion['0.15.0'].averageStressCorrectness, 3);
  assert.equal(report.scoresByVersion['0.16.0'].averageStressCorrectness, 5);
  assert.equal(report.scoresByVersion['0.15.0'].averageNaturalness, 2);
  assert.equal(report.scoresByVersion['0.16.0'].averageNaturalness, 4);
  assert.equal(report.scoresByVersion['0.15.0'].preferenceWins, 0);
  assert.equal(report.scoresByVersion['0.16.0'].preferenceWins, 3);
  assert.equal(report.preference.ties, 0);
  assert.equal(
    report.scoresByVersion['0.15.0'].preferenceWins + report.scoresByVersion['0.16.0'].preferenceWins,
    3,
  );

  const cliOutputDirectory = path.join(root, 'cli-output');
  const cliPrepare = spawnSync(process.execPath, [blindAudioScript, 'prepare', '--manifest', manifestPath, '--outdir', cliOutputDirectory], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliPrepare.status, 0, cliPrepare.stderr);
  const cliPreparation = JSON.parse(cliPrepare.stdout);
  assert.equal(cliPreparation.sampleCount, 3);
  const cliResponsesPath = path.join(cliPreparation.participantDirectory, 'responses.json');
  const cliResponses = JSON.parse(readFileSync(cliResponsesPath, 'utf8'));
  for (const response of cliResponses.responses) {
    response.preferredSide = 'tie';
    response.stressCorrectness = { A: 4, B: 4 };
    response.naturalness = { A: 3, B: 3 };
  }
  writeFileSync(cliResponsesPath, `${JSON.stringify(cliResponses, null, 2)}\n`);
  const cliReportPath = path.join(cliOutputDirectory, 'organizer', 'report.json');
  const cliScore = spawnSync(
    process.execPath,
    [blindAudioScript, 'score', '--key', cliPreparation.keyPath, '--responses', cliResponsesPath, '--out', cliReportPath],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(cliScore.status, 0, cliScore.stderr);
  assert.equal(JSON.parse(readFileSync(cliReportPath, 'utf8')).preference.ties, 3);

  responses.responses[0].naturalness.A = 6;
  writeFileSync(responsesPath, `${JSON.stringify(responses, null, 2)}\n`);
  assert.throws(() => scoreBlindStudy(prepared.keyPath, responsesPath), /integer from 1 to 5/);
  responses.responses.pop();
  writeFileSync(responsesPath, `${JSON.stringify(responses, null, 2)}\n`);
  assert.throws(() => scoreBlindStudy(prepared.keyPath, responsesPath), /every blind sample exactly once/);
  await assert.rejects(prepareBlindStudy(manifestPath, outputDir, { randomInt: () => 0 }), /already exists/);
});

test('refuses audio paths that escape the private study directory', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ua-tts-blind-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privateDirectory = path.join(root, 'private');
  mkdirSync(privateDirectory);
  writeFileSync(path.join(root, 'outside.wav'), makeWav(1, 'outside'));
  writeFileSync(path.join(root, 'outside-copy.wav'), makeWav(2, 'outside-copy'));
  const manifestPath = path.join(privateDirectory, 'study.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      format: 'ua-tts-blind-audio-study',
      version: 1,
      studyId: 'private-path-check',
      engine: 'tts-uk',
      voiceModel: 'test-voice',
      packageVersions: ['0.15.0', '0.16.0'],
      samples: [{ sampleId: 'one', text: 'Текст.', audio: { '0.15.0': '../outside.wav', '0.16.0': '../outside-copy.wav' } }],
    }),
  );
  await assert.rejects(prepareBlindStudy(manifestPath, path.join(privateDirectory, 'blind')), /escapes the study directory/);
  symlinkSync(path.join(root, 'outside.wav'), path.join(privateDirectory, 'linked.wav'));
  symlinkSync(path.join(root, 'outside.wav'), path.join(privateDirectory, 'linked-copy.wav'));
  const symlinkManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  symlinkManifest.samples[0].audio = { '0.15.0': 'linked.wav', '0.16.0': 'linked-copy.wav' };
  writeFileSync(manifestPath, JSON.stringify(symlinkManifest));
  await assert.rejects(prepareBlindStudy(manifestPath, path.join(privateDirectory, 'blind')), /resolves outside the study directory/);
  writeFileSync(path.join(privateDirectory, 'inside.wav'), makeWav(3, 'inside'));
  symlinkSync(path.join(privateDirectory, 'inside.wav'), path.join(privateDirectory, 'inside-link.wav'));
  symlinkSync(path.join(privateDirectory, 'inside.wav'), path.join(privateDirectory, 'inside-copy.wav'));
  symlinkManifest.samples[0].audio = { '0.15.0': 'inside-link.wav', '0.16.0': 'inside-copy.wav' };
  writeFileSync(manifestPath, JSON.stringify(symlinkManifest));
  await assert.rejects(prepareBlindStudy(manifestPath, path.join(privateDirectory, 'blind')), /same WAV file/);
});

test('rejects malformed and compressed WAVs before copying them', () => {
  const unsupported = makeWav(1, 'compressed tag');
  unsupported.writeUInt16LE(6, 20);
  assert.throws(() => sanitizeWav(unsupported), /only uncompressed PCM or IEEE-float WAV/);
  assert.throws(() => sanitizeWav(Buffer.from('not a wave file')), /RIFF\/WAVE/);
});
