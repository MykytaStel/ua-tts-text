#!/usr/bin/env node
/**
 * Збирає лексикон власних назв: для кожного слова бере атестований наголос зі
 * словника lang-uk, а де словник дає варіанти (Ки́їв / Киї́в) або нічого —
 * використовує ручне рішення з OVERRIDES.
 *
 *   node scripts/build-lexicon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const ACUTE = '\u0301';

const NAMES = [
  // Міста
  'Київ', 'Львів', 'Харків', 'Одеса', 'Дніпро', 'Запоріжжя', 'Вінниця', 'Полтава',
  'Чернігів', 'Черкаси', 'Житомир', 'Рівне', 'Луцьк', 'Тернопіль', 'Ужгород',
  'Мукачево', 'Кам’янець-Подільський', 'Бровари', 'Ірпінь', 'Буча', 'Гостомель',
  'Вишгород', 'Богуслав', 'Чигирин', 'Сколе', 'Яремче', 'Верховина', 'Косів',
  'Коломия', 'Дрогобич', 'Борислав', 'Трускавець', 'Стрий', 'Самбір', 'Золочів',
  'Броди', 'Кременець', 'Дубно', 'Острог', 'Ковель', 'Володимир', 'Шепетівка',
  'Хмельницький', 'Умань', 'Кропивницький', 'Олександрія', 'Марганець', 'Покровськ',
  'Бахмут', 'Слов’янськ', 'Краматорськ', 'Лисичанськ', 'Маріуполь', 'Бердянськ',
  'Мелітополь', 'Херсон', 'Генічеськ', 'Ізмаїл', 'Вилкове',
  // Люди
  'Сагайдачний', 'Дорошенко', 'Мазепа', 'Виговський', 'Довбуш', 'Шевченко',
  'Франко', 'Стус', 'Симоненко', 'Костомаров', 'Грушевський', 'Винниченко',
  'Петлюра', 'Бандера', 'Шухевич', 'Скоропадський', 'Драгоманов', 'Лисенко',
  // Бренди й установи
  'Київстар', 'Укрзалізниця', 'ПриватБанк', 'Монобанк', 'Епіцентр', 'Сільпо', 'Розетка',
];

/**
 * Ручні рішення там, де словник дає варіанти, помиляється або мовчить.
 * positions — індекси голосних у слові (нижній регістр).
 */
const OVERRIDES = {
  київ: { positions: [1], note: 'словник має помилковий варіант «Киї́в»' },
  харків: { positions: [1], note: 'словник має помилковий варіант «Харкі́в»' },
  "кам'янець-подільський": { positions: [6, 13], note: 'складне слово з двома наголосами' },
  самбір: { positions: [1], note: 'словник має зайвий варіант' },
  броди: { positions: [2], note: 'словник має зайвий варіант' },
  дубно: { positions: [1], note: 'словник має зайвий варіант' },
  кропивницький: { positions: [6], note: 'словник має зайвий варіант' },
  франко: { positions: [5], note: 'прізвище Івана Франка' },
  мукачево: { positions: [3], note: 'немає у словнику' },
  київстар: { positions: [1], note: 'немає у словнику' },
  приватбанк: { positions: [4], note: 'немає у словнику' },
  монобанк: { positions: [3], note: 'немає у словнику' },
  львів: { positions: [3], note: 'немає у словнику (односкладове)' },
  луцьк: { positions: [1], note: 'немає у словнику (односкладове)' },
  стрий: { positions: [3], note: 'немає у словнику (односкладове)' },
  стус: { positions: [2], note: 'немає у словнику (односкладове)' },
};

const dictPath = path.join(root, 'data', 'dict.bin');
const buf = readFileSync(dictPath);
const count = buf.readUInt32LE(8);
const offsets = 12;
const positionsStart = 12 + (count + 1) * 4;
const flagsStart = positionsStart + count * 2;
const keysStart = flagsStart + count;

function lookup(word) {
  const needle = Buffer.from(word, 'utf8');
  let low = 0;
  let high = count - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = buf.readUInt32LE(offsets + mid * 4);
    const end = buf.readUInt32LE(offsets + (mid + 1) * 4);
    const cmp = Buffer.compare(buf.subarray(keysStart + start, keysStart + end), needle);
    if (cmp === 0) {
      const base = positionsStart + mid * 2;
      const p1 = buf[base];
      const p2 = buf[base + 1];
      if (p1 === 255) return null;
      return { positions: p2 === 255 ? [p1] : [p1, p2], dual: buf[flagsStart + mid] === 1 };
    }
    if (cmp < 0) low = mid + 1;
    else high = mid - 1;
  }
  return null;
}

function mark(word, positions) {
  const chars = [...word];
  for (const position of [...positions].sort((a, b) => b - a)) {
    if (position < 0 || position >= chars.length) throw new Error(`bad position for ${word}`);
    chars.splice(position + 1, 0, ACUTE);
  }
  return chars.join('');
}

const rows = [];
const stats = { attested: 0, override: 0, missing: 0 };

for (const name of NAMES) {
  const key = name.toLowerCase().replace(/[’ʼ`]/gu, "'");
  const override = OVERRIDES[key];

  if (override) {
    rows.push([name, mark(name, override.positions), 'власна назва', `manual: ${override.note}`]);
    stats.override += 1;
    continue;
  }

  const hit = lookup(key);
  if (!hit) {
    stats.missing += 1;
    rows.push([name, name, 'власна назва', 'НЕМАЄ НАГОЛОСУ — додати вручну']);
    continue;
  }
  if (!hit.dual && hit.positions.length > 1) {
    stats.missing += 1;
    rows.push([name, name, 'власна назва', 'ВАРІАНТИ БЕЗ РІШЕННЯ — додати в OVERRIDES']);
    continue;
  }
  rows.push([name, mark(name, hit.positions), 'власна назва', 'lang-uk']);
  stats.attested += 1;
}

const header = '# слово\tнаголошене\tкатегорія\tджерело\n';
const body = rows.map((row) => row.join('\t')).join('\n');
writeFileSync(path.join(root, 'lexicon', 'names.tsv'), header + body + '\n');

console.log(JSON.stringify({ entries: rows.length, ...stats }, null, 2));
