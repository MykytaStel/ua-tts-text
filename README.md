# ua-tts-text

Готує український текст до озвучки: числа й дати словами, скорочення, наголоси
у форматі конкретного рушія TTS.

[![ci](https://github.com/MykytaStel/ua-tts-text/actions/workflows/ci.yml/badge.svg)](https://github.com/MykytaStel/ua-tts-text/actions/workflows/ci.yml)

Проблема, яку розв'язує: більшість рушіїв читають «1675» якось собі, «ст.» — як
«ст», а наголоси або не розуміють зовсім, або розуміють кожен по-своєму.

## Стан

| Блок | Стан |
|---|---|
| `normalize()` — числа, роки, дати, відсотки, одиниці, валюта, скорочення, пунктуація | ✅ 59 тестів |
| `stress()` — наголоси бінарним словником (2,84 млн словоформ) | ✅ |
| `render()` — профілі рушіїв | ✅ |
| `homographs()` / `decisions` — омоніми з двома варіантами і вибір людини/LLM | ✅ |
| `lint()` — що лишилось небезпечним у тексті | ✅ |
| Лексикон власних назв (`lexicon/names.tsv`) | ✅ 84 назви |
| SKILL.md для агентів | ✅ `skills/ua-voiceover-prep/` |
| Публікація (npm, skills.sh) | ⏳ |

## Встановлення

```bash
git clone https://github.com/MykytaStel/ua-tts-text.git
cd ua-tts-text
pnpm install && pnpm build
node scripts/fetch-dict.mjs   # 75 МБ словника, один раз
```

Пакет у npm поки не опублікований — після публікації буде `npm i ua-tts-text`.

Скіл для агентів ставиться прямо з репозиторію:

```bash
npx skills add MykytaStel/ua-tts-text
```

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

## Розв'язання омонімів агентом

```ts
import { applyDecisions, parseDecisions, prepare, reviewPrompt } from 'ua-tts-text';

const first = prepare(text, { dictionary, engine: 'tts-uk' });
const prompt = reviewPrompt(first.homographs); // готовий запит для LLM
// …модель відповідає {"замок": 0, "горі": 1}
const { decisions, missing } = applyDecisions(first.homographs, parseDecisions(answer));
const final = prepare(text, { dictionary, engine: 'tts-uk', stress: { decisions } });
```

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

20 сценаріїв, 255 слів, 144 багатоскладових. Покриття — частка слів, що потребують
наголосу і справді його отримали; решта — омоніми й невідомі слова.

| варіант | наголошено | омоніми | невідомі | покриття |
|---|---|---|---|---|
| без обробки | 0 | — | — | 0% |
| словник | 211 | 23 | 1 | 89,8% |
| словник + рішення для омонімів | 235 | 0 | 1 | 99,6% |

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
node scripts/cli.mjs --engine tts-uk < script.txt
node scripts/cli.mjs --engine tts-uk --decisions corpus/decisions.json < script.txt
node scripts/cli.mjs --engine piper-high --json < script.txt
```

## Словник

```bash
curl -o data/stress.txt https://raw.githubusercontent.com/lang-uk/ukrainian-word-stress-dictionary/master/stress.txt
node scripts/build-dict.mjs   # → data/dict.bin, ~75 МБ
```

Словник наголосів — [lang-uk/ukrainian-word-stress-dictionary](https://github.com/lang-uk/ukrainian-word-stress-dictionary)
(пакет MIT; у самому репозиторії словника файл LICENSE відсутній).

## Свідомі обмеження

- Числа читаються в називному відмінку.
- Діапазони «5–7» не переписуються у «від п'яти до семи».
- Складені назви з дефісом («Кам'янка-Бузька») отримують лише один наголос — це робота лексикону.
- Абревіатури — невелика таблиця; решта лишається як є.
- Латинські назви не транслітеруються, а лише потрапляють у звіт.

## Ліцензія

MIT.
