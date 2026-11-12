#!/usr/bin/env node
/**
 * Вимірює реальний темп рушія: слова за хвилину з живого аудіо.
 *
 *   node scripts/calibrate-pace.mjs --wav out.wav --text "текст, який озвучили"
 *
 * Саме так виміряно 125 слів/хв для tts-uk (62 слова за 30,3 с), а не взято з голови.
 */
import { execFileSync } from 'node:child_process';

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const wav = arg('wav');
const text = arg('text');
if (!wav || !text) {
  console.error('usage: calibrate-pace.mjs --wav out.wav --text "озвучений текст"');
  process.exit(2);
}

const seconds = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim(),
);
const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;
console.log(
  JSON.stringify({ wav, words, seconds: Math.round(seconds * 100) / 100, wordsPerMinute: Math.round((words / seconds) * 60) }, null, 2),
);
