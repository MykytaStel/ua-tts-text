# ua-tts-text

Готує український текст до озвучки: числа й дати словами, скорочення, наголоси
у форматі конкретного рушія TTS.

[![ci](https://github.com/MykytaStel/ua-tts-text/actions/workflows/ci.yml/badge.svg)](https://github.com/MykytaStel/ua-tts-text/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ua-tts-text)](https://www.npmjs.com/package/ua-tts-text)
[![skills.sh](https://img.shields.io/badge/skills.sh-ua--voiceover--prep-blue)](https://www.skills.sh/mykytastel/ua-tts-text/ua-voiceover-prep)

Проблема, яку розв'язує: більшість рушіїв читають «1675» якось собі, «ст.» — як
«ст», а наголоси або не розуміють зовсім, або розуміють кожен по-своєму.

## Стан

| Блок | Стан |
|---|---|
| `normalize()` — числа, діапазони, роки, дати, відсотки, одиниці, валюта, скорочення, пунктуація | ✅ 77 тестів |
| `stress()` — наголоси бінарним словником (2,84 млн словоформ) | ✅ |
| `render()` — профілі рушіїв | ✅ |
| `homographs()` / `decisions` — омоніми з двома варіантами і вибір людини/LLM | ✅ |
| `lint()` — що лишилось небезпечним у тексті | ✅ |
| Лексикон власних назв (`lexicon/names.tsv`) | ✅ 84 назви |
| Дефісні слова й морфологічний фолбек | ✅ 88 тестів |
| Слова поза словником через LLM (`resolveUnknown`) | ✅ |
| SKILL.md для агентів | ✅ `skills/ua-voiceover-prep/` |
| Публікація (npm, skills.sh) | ⏳ |

## Встановлення

```bash
npm i ua-tts-text
npx ua-tts-text-fetch-dict    # 75 МБ словника, один раз → ~/.local/share/ua-tts-text/
```

Далі CLI сам знаходить словник: `--dict` → `UA_TTS_DICT` → `~/.local/share/ua-tts-text/dict.bin`
→ `data/dict.bin` усередині пакета. Перекрити теку можна `UA_TTS_HOME`.

Для розробки — з репозиторію:

```bash
git clone https://github.com/MykytaStel/ua-tts-text.git
cd ua-tts-text && pnpm install && pnpm build && node scripts/fetch-dict.mjs
```

Скіл для агентів ставиться прямо з репозиторію:

```bash
npx skills add MykytaStel/ua-tts-text
```

Скіл уже в каталозі: [skills.sh/mykytastel/ua-tts-text](https://www.skills.sh/mykytastel/ua-tts-text/ua-voiceover-prep).

## Використання

```ts
import { StressDictionary, prepare } from 'ua-tts-text';

const dictionary = StressDictionary.load('./data/dict.bin');

const result = prepare('У 1675 році на 5 км шляху — 22% вологи.', {
  dictionary,
  engine: 'tts-uk',
});
// result.text
// «у т+исяча шістс+от сімдес+ят п'+ятому р+оці на п'ять кілом+етрів шляху, дв+адцять два відс+отки вол+оги.»
```

Омоніми не вгадуються мовчки — вони повертаються списком із двома прочитаннями:

```ts
result.homographs;
// [{ word: 'Замок', key: 'замок', variants: ['За́мок', 'Замо́к'] }, ...]

const fixed = prepare(text, {
  dictionary,
  engine: 'tts-uk',
  stress: { decisions: { замок: 0 } }, // 0 — перший варіант, 1 — другий
});
```

## Розв'язання омонімів через LLM

Один запит на весь текст — модель бачить речення й обирає варіант:

```bash
UA_TTS_LLM_KEY=... UA_TTS_LLM_BASE_URL=https://api.deepseek.com UA_TTS_LLM_MODEL=deepseek-chat \
  node scripts/cli.mjs --engine tts-uk --resolve < script.txt
```

```ts
import { createOpenAiAsker, prepareMany } from 'ua-tts-text';

const ask = createOpenAiAsker({ apiKey, model: 'deepseek-chat' });
const { results, decisions, promptLength } = await prepareMany(paragraphs, {
  dictionary, engine: 'tts-uk', ask,
});
```

Запит на 5 омонімів — близько 900 символів; на ролик із 300 слів це один виклик і частки цента.
Резолвер вимкнений, поки не задано `ask` (у CLI — `--resolve`).

## Розв'язання омонімів агентом

```ts
import { applyDecisions, parseDecisions, prepare, reviewPrompt } from 'ua-tts-text';

const first = prepare(text, { dictionary, engine: 'tts-uk' });
const prompt = reviewPrompt(first.homographs); // готовий запит для LLM
// …модель відповідає {"замок": 0, "горі": 1}
const { decisions, missing } = applyDecisions(first.homographs, parseDecisions(answer));
const final = prepare(text, { dictionary, engine: 'tts-uk', stress: { decisions } });
```

## Слова поза словником

Три рівні, від найдешевшого:

1. **Дефісні слова** — кожна частина наголошується окремо: `пів-України` → `пів-Укра+їни`.
2. **Морфологічний фолбек** — форма успадковує наголос від спільного стема
   (`ковбасити` → `ковб+асити`). На held-out вибірці словника: 98% точності, 14,5% покриття.
3. **Суфіксна модель** — останні 5 літер і найчастіша відстань до кінця, але лише
   з упевненістю ≥70% (`діджиталізація` → `діджиталіз+ація`).
4. **LLM** — для решти `prepareMany` питає індекс наголошеної голосні й перевіряє його.

Разом це закриває близько половини невідомих слів автоматично з точністю ~87%,
решту — LLM або людина.

## План мовлення

`planSpeech()` каже, як читати: межі речень і підрядних частин, паузи під них,
тип речення й оцінку тривалості.

```ts
const plan = planSpeech('Раз, два. Хто це?');
// segments: [ {text:'Раз,', pauseAfterMs:220}, {text:'два.', pauseAfterMs:480}, {text:'Хто це?', pauseAfterMs:0} ]
renderPlan(plan, 'ssml'); // <speak>Раз,<break time="220ms"/> два.<break time="480ms"/> Хто це?</speak>
```

Свідоме обмеження: це детермінована розмітка, а не модель інтонації. Природну
інтонацію дає лише тренована акустика; план керує тим, що реально передається
рушіям — паузами й межами фраз.

## Профілі рушіїв

| Рушій | Формат | Перевірено |
|---|---|---|
| `tts-uk`, `holos-voice` | `+` перед голосною | ✅ модель навчена на такому записі |
| `silero`, `rhvoice` | `+` перед голосною | за документацією |
| `styletts2` | `+` після складу | за документацією |
| `piper-medium` | акут U+0301 | ✅ `phoneme_type: text`, акут — окремий токен |
| `piper-high` | — | ❌ espeak-ng ставить наголос сам; U+0301 відкидається, `+` читається як «плюс» |
| `elevenlabs-v4` | IPA | ⏳ профіль у роботі (для неанглійської IPA лише на v4/v4_turbo) |
| `edge-tts`, `azure` | — | наголоси не приймають; для `uk-UA` SSML IPA не заявлено |

## Baseline на golden corpus

31 сценарій, 319 слів, 174 багатоскладових. Покриття — частка слів, що потребують
наголосу і справді його отримали; решта — омоніми й невідомі слова.

| варіант | наголошено | омоніми | невідомі | покриття |
|---|---|---|---|---|
| без обробки | 0 | — | — | 0% |
| словник | 211 | 23 | 1 | 89,8% |
| словник + рішення для омонімів | 297 | 0 | 2 | 99,3% |

Тобто сам словник дає ~90%, а останні 10% — це робота, яку досі ніхто не автоматизував:
вибір прочитання за контекстом. Це і є причина існування скіла.

## Лексикон власних назв

Словник lang-uk містить і помилкові варіанти («Киї́в» поруч із «Ки́їв»), і не знає
брендів. Лексикон — шар поверх нього, який має пріоритет:

```
Київ	Ки́їв	власна назва	manual: словник має помилковий варіант «Киї́в»
```

На 84 назвах (міста, історичні постаті, бренди):

| джерело | омоніми | невідомі |
|---|---|---|
| лише словник | 7 | 4 |
| + лексикон | 0 | 0 |

## Скіл для агентів

`skills/ua-voiceover-prep/SKILL.md` — тонка обгортка: коли застосовувати, який профіль
рушія вибрати, як розв'язувати омоніми через `decisions` і чого не робити
(наприклад, не намагатися полагодити `piper-high` позначками).

Перевірено встановленням у чистому середовищі:

```bash
npx skills add MykytaStel/ua-tts-text
# ✓ ./.agents/skills/ua-voiceover-prep
#   universal: Amp, Antigravity, Cline, Codex +19 more
#   symlinked: Claude Code, Eve
```

Тобто один файл справді працює в трьох агентах — це не припущення, а результат установки.

## Інтеграція у Content Factory

Гілка `feat/ua-tts-text` у репозиторії фабрики (окремий worktree, `main` не зачеплений):

- `packages/providers/src/tts-text-prep.ts` готує абзаци до синтезу (числа, дати, наголоси, лексикон);
- `tts-uk.ts` передає готовий текст Python-скрипту з прапорцем `prepared: true`, і той лише синтезує;
- якщо словника на машині немає — працює старий Python `prepare()`, тобто деградація плавна.

End-to-end перевірка на `tts-uk` (M1 Pro, CPU): вхід «У 1675 році на 5 км шляху — 22% вологи. Замок стоїть на горі.»
→ 9 с аудіо. Зразки: `samples/prepared-tts-uk.wav` (новий шлях) і `samples/fallback-tts-uk.wav` (старий).

Словник і лексикон для рантайму лежать у `~/.local/share/ua-tts-text/` (шляхи перекриваються
`UA_TTS_DICT` і `UA_TTS_LEXICON`).

## CLI

```bash
npx ua-tts-text --engine tts-uk < script.txt
node scripts/cli.mjs --engine tts-uk < script.txt
node scripts/cli.mjs --engine tts-uk --decisions corpus/decisions.json < script.txt
node scripts/cli.mjs --engine piper-high --json < script.txt
```

## Словник

```bash
npx ua-tts-text-fetch-dict          # у ~/.local/share/ua-tts-text/dict.bin
node scripts/fetch-dict.mjs --local # у ./data/dict.bin (репозиторій)
```

Словник наголосів — [lang-uk/ukrainian-word-stress-dictionary](https://github.com/lang-uk/ukrainian-word-stress-dictionary)
(пакет MIT; у самому репозиторії словника файл LICENSE відсутній).

## Свідомі обмеження

- Числа читаються в називному відмінку; у діапазонах («5–7») — у родовому.
- Складені назви з дефісом («Кам'янка-Бузька») отримують лише один наголос — це робота лексикону.
- Абревіатури — невелика таблиця; решта лишається як є.
- Латинські назви не транслітеруються, а лише потрапляють у звіт.

## Ліцензія

MIT.
