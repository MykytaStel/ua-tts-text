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
| `normalize()` — числа, діапазони, роки, дати, відсотки, одиниці, валюта, скорочення, пунктуація | ✅ модульні кейси + 13 точних fixtures |
| `scanSemanticSpans()` — типізовані позиції дат, часу, дробів, кодів і одиниць | 🧪 початковий розбір; неоднозначності треба перевіряти |
| `stress()` — наголоси бінарним словником (2,84 млн словоформ) | ✅ |
| `render()` — профілі рушіїв | ✅ |
| `homographs()` / `decisions` — омоніми з двома варіантами і вибір людини/LLM | ✅ |
| `lint()` — що лишилось небезпечним у тексті | ✅ |
| Лексикон власних назв (`lexicon/names.tsv`) | ✅ 84 назви |
| Спільний токенізатор, построковий аудит і мультимножинна оцінка наголосів | ✅ модульні й CLI перевірки |
| Перевірка TSV, походження лексиконного рядка й trace джерела наголосу | ✅
| Слова поза словником через LLM (`resolveUnknown`) | ✅ |
| SKILL.md для агентів | ✅ `skills/ua-voiceover-prep/` |
| Сліпе A/B аудіо для двох версій | ✅ нова команда `ua-tts-text-blind-audio` у `0.16.0` |
| Проєктні правила читання | ✅ `NormalizationRules` і локальний `normalization.tsv` у `0.17.0` |
| Відображення нормалізованого фрагмента на конкретне входження у джерелі | ✅ `normalizeWithAlignment()` з UTF-16 позиціями у `0.21.0` |
| Збережені виправлення одного входження | ✅ `NormalizationCorrectionSet` із fingerprint перевіркою у `0.21.0` |
| CLI для проєктних правил і trace | ✅ `--normalization`, `--explain`; позиції змін у джерелі у `0.21.0` |
| Реліз | вихідний код `0.21.0`; npm `latest` — `0.20.0` (2026-11-15) |
| Перегляд омонімів і невідомих слів у CLI | ✅ ручний вибір для кожного входження з перевіркою fingerprint |

## Встановлення

Потрібен Node.js 22 або новіший.

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

Короткий текст іде одним запитом; довгий ділиться на обмежені порції. Кожне
входження має власний ID, а невідповідь лишається в черзі перевірки:

```bash
UA_TTS_LLM_KEY=... UA_TTS_LLM_BASE_URL=https://api.deepseek.com UA_TTS_LLM_MODEL=deepseek-chat \
  node scripts/cli.mjs --engine tts-uk --resolve < script.txt
```

```ts
import { createOpenAiAsker, prepareMany } from 'ua-tts-text';

const ask = createOpenAiAsker({ apiKey, model: 'deepseek-chat' });
const { results, decisions, promptLength } = await prepareMany(paragraphs, {
  dictionary, engine: 'tts-uk', ask, maxPromptChars: 12_000,
});
```

`maxPromptChars` обмежує кожен запит (типово 12 000 символів). За замовчуванням
помилка провайдера зупиняє операцію. `resolutionFailurePolicy: 'leave-unresolved'`
повертає часткові рішення, лишає проблемні порції у `missing` і додає `warnings`.
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
2. **Морфологічний фолбек** — евристика споріднених форм може запропонувати наголос
   (`ковбасити` → `ковб+асити`). Це припущення, яке треба перевірити для цільового тексту.
3. **Суфіксна модель** — останні 5 літер і найчастіша відстань до кінця, але лише
   з упевненістю ≥70% (`діджиталізація` → `діджиталіз+ація`).
4. **LLM** — `prepareMany` розв’язує омоніми по входженнях; вгадування невідомих слів потребує `resolveUnknown: true`.

Загальну точність цього шляху незалежно не виміряно. Для невідомих назв безпечніше
перевірити результат у контексті й зберегти підтверджену форму в проєктному лексиконі.

## План мовлення

`planSpeech()` каже, як читати: межі речень і підрядних частин, паузи під них,
тип речення й оцінку тривалості.

```ts
const plan = planSpeech('Раз, два. Хто це?');
// segments: [ {text:'Раз,', pauseAfterMs:220}, {text:'два.', pauseAfterMs:480}, {text:'Хто це?', pauseAfterMs:0} ]
renderPlan(plan, 'ssml'); // <speak>Раз,<break time="220ms"/> два.<break time="480ms"/> Хто це?</speak>
```

Темп (125 слів/хв) виміряно на реальному аудіо tts-uk, а не взято з голови;
перевірити свій рушій можна `scripts/calibrate-pace.mjs --wav out.wav --text "…"`.
Емфаза ставиться на запереченнях і контрасті («не», «але», «однак») та на окликах.

Свідоме обмеження: це детермінована розмітка, а не модель інтонації. Природну
інтонацію дає лише тренована акустика; план керує тим, що реально передається
рушіям — паузами й межами фраз.

## Контекстні правила

Словник знає, що слово має два наголоси, але не знає, який стоїть у реченні.
Сусіднє слово часто вирішує це детерміновано — і тоді LLM не потрібен:

```
роки     ро́ки   prev:@few        # три ро́ки
тому     тому́   next:що          # тому́ що
горі     горі́   prev:на          # на горі́
дорога   доро́га next:веде        # дорога веде
```

Правила лежать у `lexicon/context.tsv` (умови `prev:`, `next:`, `prev2:`, `next2:`,
`prev~`, `next~`, `first`, `last`, `*`, набори `@gen`) і не потребують коду, щоб доповнити.
`prev2`/`next2` потрібні, коли між числівником і словом стоїть прикметник:
«два великі міста́».
Що правило не покрило — лишається омонімом для людини або LLM.

## Профілі рушіїв

| Рушій | Формат | Перевірено |
|---|---|---|
| `tts-uk`, `holos-voice` | `+` перед голосною | ✅ модель навчена на такому записі |
| `silero`, `rhvoice` | `+` перед голосною | за документацією |
| `styletts2` | `+` після складу | за документацією |
| `piper-medium` | акут U+0301 | ✅ `phoneme_type: text`, акут — окремий токен |
| `piper-high` | поки немає адаптера | графічний наголос тут не перевірений; актуальний Piper CLI документує raw espeak-ng phoneme input, але конкретна українська версія/голос ще потребує аудіоперевірки |
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

Content Factory споживає пакет як npm-залежність. Після публікації нової версії
оновлюються версія залежності й lockfile у Studio; runtime-підготовка користується
спільним API пакета та відбитком ресурсів для ідентичності кешу синтезу.

Словник і лексикон для рантайму лежать у `~/.local/share/ua-tts-text/` (шляхи перекриваються
`UA_TTS_DICT`, `UA_TTS_LEXICON` і `UA_TTS_HOME`). Пакет можна використовувати окремо
від Studio через CLI або програмний API.

## CLI

```bash
npx ua-tts-text --engine tts-uk < script.txt
node scripts/cli.mjs --engine tts-uk < script.txt
node scripts/cli.mjs --engine tts-uk --decisions corpus/decisions.json < script.txt
node scripts/cli.mjs --engine piper-high --json < script.txt
node scripts/cli.mjs --engine piper-medium --normalization project/normalization.tsv --explain --json < script.txt
node scripts/cli.mjs --engine tts-uk --strict --json < script.txt
```

`--normalization <path>` явно вибирає TSV із проєктними правилами й перекриває
`UA_TTS_NORMALIZATION`. `--explain --json` додає до `normalizationTrace` fingerprint
правил і `steps` — кожне фактичне перетворення нормалізатора в порядку виконання.
Крок має стадію, змінений фрагмент до й після та коротке пояснення; для перевіреного
проєктного правила також указується `source`. `--explain` без `--json` виводить ті
самі кроки у stderr. Текст у `before` і `after` є вмістом фрагментів, тож передавай
детальну трасу в журнали лише якщо це дозволяє політика даних проєкту. `sourceStart`
і `sourceEnd` — UTF-16 межі початкового вводу для дат, часу, дробів, співвідношень
та кодів із початковими нулями;
для послідовних legacy-проходів таких координат поки немає.

`--strict` додає `strictGate` у JSON та завершує CLI з кодом `1`, якщо лишилися
lint-проблеми, невирішені омоніми/невідомі слова, відсутній/неповний словник або
розпізнаний, але недійсний чи неоднозначний числовий фрагмент.
Попередження про рушії, що навмисно не приймають позначки наголосу, саме по собі
строгий режим не провалює.

Той самий гейт доступний із програмного API: `checkPrepared(result)` повертає
`passed` і структурований список `findings`; Studio може відмовитися запускати
синтез за тим самим правилом, що й CI. Щоб він також побачив короткі невідомі
багатоскладові слова, передай у `prepare()` `stress: { minReportLength: 1 }`;
CLI робить це автоматично в режимі `--strict`.

```ts
const resources = loadResources({ required: true });
const prepared = prepare(input, {
  resources,
  engine: 'tts-uk',
  stress: { minReportLength: 1 },
});
const gate = checkPrepared(prepared);
if (!gate.passed) console.error(gate.findings);
```

Числові та часові фрагменти можна переглянути окремо. Кожен span містить `kind`,
`raw`, `start` і `end`; типізовані дати, час, дроби й ідентифікатори також мають
розібране `value`. Позиції — UTF-16 у вихідному тексті:

```ts
const spans = scanSemanticSpans('О 12:30 додай 1/2 склянки; код 000123.');
// time, fraction, identifier
```

Початкові прочитання: `12:30` як час, `2:1` як співвідношення, `1/2 склянки` як
`пів склянки`, `2026-11-15` як дата. Недійсні ISO-дати, час і непідтримані дроби
не переписуються автоматично та з'являються в `semanticFindings`. Часові зони й
інші формати поки потребують окремих правил.

### Ручний перегляд омонімів і невідомих слів (CLI у 0.15.0)

Експортуй review-файл без LLM. Для омонімів вибери `0` або `1` у полі `choice`.
Для невідомого слова вибери одну з позицій у масиві `vowels` і запиши її в
`stressPosition`. Індекси — позиції Unicode-символів у слові; для однакових слів
у різних місцях можна вибрати різні голосні:

```bash
ua-tts-text --engine tts-uk --review-out review.json < script.txt
# у review.json заповнити choice / stressPosition для потрібних входжень
ua-tts-text --engine tts-uk --apply-review review.json < script.txt > prepared.txt
```

Запис невідомого слова містить контекст і перелік голосних, наприклад:

```json
{
  "kind": "unknown",
  "id": "0:14",
  "word": "Краудфандинг",
  "vowels": [
    { "position": 2, "letter": "а" }, { "position": 3, "letter": "у" },
    { "position": 6, "letter": "а" }, { "position": 9, "letter": "и" }
  ],
  "stressPosition": null
}
```

Файл прив'язаний до нормалізованого тексту, рушія та fingerprint ресурсів.
Якщо змінилися текст, словник чи лексикон, CLI відхилить файл і попросить
створити новий. Невибрані омоніми й невідомі слова лишаються у звіті.

У програмному API ті самі ручні наголоси задаються через `prepareMany()`:

```ts
const { results } = await prepareMany(['Краудфандинг. Краудфандинг.'], {
  dictionary,
  engine: 'tts-uk',
  occurrenceOverrides: { '0:0': 2, '0:14': 9 },
});
```

## Словник

```bash
npx ua-tts-text-fetch-dict          # у ~/.local/share/ua-tts-text/dict.bin
node scripts/fetch-dict.mjs --local # у ./data/dict.bin (репозиторій)
```

Словник наголосів — [lang-uk/ukrainian-word-stress-dictionary](https://github.com/lang-uk/ukrainian-word-stress-dictionary)
(пакет MIT; у самому репозиторії словника файл LICENSE відсутній).

## Свідомі обмеження

- Числа узгоджуються з поширеними контекстами (`до`/`від`, одиниці виміру й діапазони); це не повний морфологічний коректор довільних речень.
- Складені назви з дефісом («Кам'янка-Бузька») отримують лише один наголос — це робота лексикону.
- Абревіатури — невелика таблиця; решта лишається як є.
- Латинські назви не транслітеруються, а лише потрапляють у звіт.

## Аудит своїх текстів

```bash
node scripts/audit.mjs --dir ~/шлях/до/сценаріїв
```

Показує частку наголошених слів по файлах і найчастіші слова, які лишились
без наголосу — це готовий список для `lexicon/` і `context.tsv`.

## Оцінка якості

```bash
npm run eval
```

Золотий набір — `evaluation/gold.tsv`: 28 регресійних речень, не незалежний holdout. Останній локальний прогін: **точність 100,0%, повнота 97,0%, F1 98,5%; 28/28 рядків зі збереженою послідовністю слів**. Тепер scorer вимагає всі очікувані наголоси й карає зайві, зокрема неповний багатонаголосний варіант. Чотири пропуски: невирішений омонім «замок», «доєднатися» поза словником і два речення, де в gold дозволено обидва наголоси, а пакет видав лише один. Це не оцінка згенерованого аудіо й не незалежний holdout. Перевірки нормалізації: 13 точних fixtures.

Спірні місця для перевірки людиною — `evaluation/review.md`.

## Ліцензія

MIT.


### 0.13 integration contract

```ts
import { loadResources, prepareMany } from 'ua-tts-text';
const resources = loadResources({ required: true });
const batch = await prepareMany(paragraphs, {
  resources,
  engine: 'tts-uk',
});
// Include resources.manifest.fingerprint in generated-audio cache identity.
// Reuse batch.decisionFingerprint to reject stale per-occurrence choices.
```

Bundled common/names are loaded first, then local common/names override them.
Project context rules are evaluated before bundled rules. Explicit lexicon rows are protected from broad context rules. `UA_TTS_HOME`,
`UA_TTS_DICT`, and `UA_TTS_LEXICON` are shared by CLI and the API loader.
No local files are modified by loading resources. Explicit missing lexicons fail.

Migration: `prepareMany().decisions` is keyed by `paragraph:offset` (UTF-16 offsets
in normalized input). `prepareMany()` also returns a `decisionFingerprint`; pass it
back as `expectedDecisionFingerprint` with saved manual choices to reject stale
offsets after normalized text or resource changes. For multiple paragraphs, use
`occurrenceDecisions` keys such as `0:12`; legacy `stress.occurrenceDecisions` is
accepted only for one paragraph. Do not pass `prepareMany().decisions` to
`stress.decisions`, which remains a global word override. `homographs()` returns
unresolved occurrences and offsets.
Unknown-word LLM guessing is disabled unless `resolveUnknown: true`. Such guesses
remain unverified and should not be persisted as normative dictionary entries.

The dictionary fetcher uses `scripts/dictionary-source.json`; it checks the source
hash before building. An existing different binary is retained as `dict.<sha256>.bin`.
For rollback, select that file with `UA_TTS_DICT`; keep the matching npm version and
local TSV snapshot. The resource manifest identifies what was actually loaded.
The package prepares speech text; it does not correct arbitrary grammar. Accuracy
on the regression corpus is not an independent held-out or listening assessment.

## Проєктні назви й власні словоформи

Пакет спершу бере вбудовані загальні форми, потім вбудовані назви, і нарешті локальний лексикон із `UA_TTS_LEXICON` або `--lexicon`. Для конкретного проєкту створи окремий `names.tsv`; повний шаблон із колонками для категорії, джерела, проєкту, основної назви й статусу є в `lexicon/project-template.tsv`. Старі чотириколонкові рядки сумісні. Кожну потрібну відмінкову форму додавай явно: лексикон не вигадує граматичне відмінювання власних назв. Рядки `draft` і `rejected` видно через `lexicon.inactiveEntries`, але вони не впливають на вимову. TSV-помилки (неправильний наголос, дубль у файлі, невідповідне слово чи невідомий статус) зупиняють завантаження з конкретним повідомленням.

Налаштуй шлях один раз для середовища: `UA_TTS_LEXICON=/path/to/project/names.tsv`. API `prepare()` приймає `lexicon` без базового словника для вузьких проєктних override-ів, але попереджає, що загальне покриття наголосів буде неповним. Ресурсний fingerprint охоплює версію пакета, runtime-модулі бібліотеки, словник, лексикони, контекстні й normalization-правила — зміни коду або файлів також скидають кеш генерації. Його можна додати до журналу синтезу.

## Проєктні правила читання

Для скорочень, назв брендів і точних фраз, яких немає у вбудованій таблиці, створи `~/.local/share/ua-tts-text/normalization.tsv`, вкажи шлях через `UA_TTS_NORMALIZATION` або передай `--normalization project/normalization.tsv` у CLI. Формат рядка: `збіг<TAB>читання<TAB>джерело<TAB>статус`:

```tsv
АТБ	а-те-бе	затверджено редактором проєкту	verified
Київська область	Київщина	глосарій проєкту	verified
назва-кандидат	варіант для перевірки	чернетка редактора	draft
```

Правила збігаються як цілі літеральні фрази без урахування регістру; кілька пробілів вважаються одним. Для перекривних фраз береться найдовша. Читання не проганяється повторно через нормалізатор, щоб зберегти його текст. Локальний рядок перекриває вбудований із тим самим збігом. `draft` і `rejected` доступні через `resources.normalization.inactiveEntries`, але не застосовуються.

`prepare()` завантажує правила зі спільним знімком ресурсів; змінений TSV змінює fingerprint і може скинути кеш синтезу. Пояснення конкретного збігу доступне через `resources.normalization.explain('АТБ')`. Для прямого виклику можна передати `normalize(text, { rules })`.

Щоб побачити всі перетворення нормалізатора за один виклик, скористайся `normalizeWithTrace()`:

```ts
const { text, ruleApplications, steps } = normalizeWithTrace(input, { rules: resources.normalization });
// step: { stage, before, after, explanation, source? }
// ruleApplications лишається сумісним зі структурою 0.18.0.
```

`steps` фіксує Unicode-уніфікацію, проєктні правила, числа й групи цифр, порядкові
числівники, дати, відсотки, валюти, одиниці, скорочення, абревіатури, ідентифікатори
та пунктуацію. `before`/`after` — саме змінені фрагменти; кожен крок має
`sourceStart`/`sourceEnd` у початковому тексті. `text` дорівнює результату `normalize()`
з тими самими параметрами; якщо
стадія нічого не змінює, крок для неї не додається.

Для редактора озвучки потрібні також позиції кожного фрагмента у фінальному тексті.
`normalizeWithAlignment()` повертає сегменти з діапазонами і текстом у джерелі та в
результаті. Незмінені слова мають окремі сегменти, повтори — незалежні координати,
а розгортання короткого запису в кілька слів залишається одним вирівняним сегментом.

```ts
const result = normalizeWithAlignment('5 км і 5 км.');
const changed = result.alignment.filter((segment) => segment.changed);
// Кожне з двох входжень має власні sourceStart/sourceEnd і spokenStart/spokenEnd.
```

Усі позиції — UTF-16 індекси, сумісні з `String.slice()`. Сегменти покривають
озвучуваний вихід; символи, які нормалізатор вилучив як пунктуацію, не створюють
порожній сегмент. Вирівнювання показує походження тексту, але саме по собі не
підтверджує правильність прочитання.

Studio може зберегти ручне виправлення для одного точного входження й застосувати
його після наступного запуску того самого тексту:

```ts
const input = 'АТБ відкрився.';
const preview = normalizeWithAlignment(input);
const brand = preview.alignment.find((segment) => segment.sourceText === 'АТБ');
if (!brand) throw new Error('Не знайдено сегмент назви');

const corrections = createNormalizationCorrectionSet(preview, [{
  sourceStart: brand.sourceStart,
  sourceEnd: brand.sourceEnd,
  spokenStart: brand.spokenStart,
  spokenEnd: brand.spokenEnd,
  replacement: 'а-те-бе',
  source: 'перевірено редактором',
}]);
const corrected = normalizeWithAlignment(input, { corrections });
// JSON.stringify(corrections) можна зберегти у файлі проєкту.
const prepared = prepare(input, { engine: 'tts-uk', normalizationCorrections: corrections });
```

Набір зберігає текст вибраного фрагмента, позиції, очікуване базове прочитання
і SHA-256 fingerprint тексту, результату та правил. Змінений текст, нормалізація
чи набір правил відхилять застарілий набір замість перенесення виправлення на інше
входження. `prepare()` приймає цей набір у `normalizationCorrections` і застосовує його
до нормалізованого тексту перед наголосами та передачею рушію. `prepareMany()`
відхиляє один набір для кількох різних текстів. JSON містить фрагменти користувацького
тексту: зберігай його у своїх проєктних даних і не журналюй без потреби. Звичайний
`normalize()` лишається базовим нормалізатором.

## Оцінювання

`pnpm test` запускає модульні тести зі словником і без нього, перевірки TSV, оцінювача, рецензування входжень, побудови словника, сліпого A/B пакета й точні fixtures нормалізації. `node scripts/package-smoke.mjs` пакує npm-архів, встановлює його в тимчасовий каталог і перевіряє API та всі CLI.

`pnpm eval` оцінює регресійний gold-набір; `pnpm eval:normalization` повторно перевіряє точні виходи нормалізатора. Для незалежного аудіювання підготуй приватний маніфест із двома WAV для кожного holdout-прикладу:

```bash
npx ua-tts-text-blind-audio prepare \
  --manifest evaluation/private/study.json \
  --outdir evaluation/private/blind-study
# передай слухачу тільки evaluation/private/blind-study/participant/
npx ua-tts-text-blind-audio score \
  --key evaluation/private/blind-study/organizer/key.json \
  --responses evaluation/private/blind-study/participant/responses.json \
  --out evaluation/private/blind-study/organizer/report.json
```

Команда приймає лише PCM або IEEE-float WAV, перемішує приклади й збалансовано призначає сторони A/B, прибирає RIFF-теги з копій та зберігає версійний ключ лише в `organizer/`. Папка `evaluation/private/` виключена з Git. Оцінки є описовими для конкретного прослуховування; інструмент не оголошує статистичну значущість або загальну якість за одним набором.

Повна схема маніфесту й процедура описані в [evaluation/README.md](evaluation/README.md). Золоті fixtures залишаються регресійними, не є незалежним holdout і не замінюють сліпе аудіювання.
