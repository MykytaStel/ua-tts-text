# Changelog

## 0.15.0 — 2026-11-13

- CLI експортує омоніми з контекстом і варіантами в редагований JSON; вибір `0`/`1` можна застосувати окремо для кожного входження.
- Review CLI також експортує кожне невідоме слово з контекстом і позиціями голосних; ручний наголос задається окремо для кожного входження без LLM.
- `prepareMany()` приймає `occurrenceOverrides` з ключами `paragraph:UTF16Offset`, щоб повтори невідомого слова могли мати різні наголоси.
- Review-файл прив'язаний до нормалізованого тексту, рушія й fingerprint ресурсів; застарілі або змінені записи відхиляються.
- README та інструкція публікації синхронізуються з фактичним станом npm і споживанням пакета у Studio.
- Звіт оцінки й baseline оновлені з pinned словником: 2 834 916 записів без невалідних рядків; regression quality gate лишився зеленим.

## 0.14.0 — 2026-11-13

- Нормалізація розрізняє роки, кількість, дроби, діапазони й захищені ідентифікатори; неіснуючі дати та версії лишаються незміненими.
- Лексикон і словник суворо перевіряються; некоректні рядки словника не дають хибного наголосу, а CI сканує весь бінарний індекс.
- Спільна токенізація, пояснення наголосу по входженнях і відбитки ресурсів дають змогу відтворити рішення; `decisionFingerprint` відхиляє застарілі offsets.
- LLM-резолвер обмежує розмір порцій, повідомляє про невирішені відповіді й підтримує явну політику помилок.
- CI перевіряє пакет після встановлення, запускає оцінку з порогами якості й тестує Node.js 22, 24 та 26. Перед `npm publish` виконуються збірка, typecheck, тести та smoke-перевірка.
- CLI entry points мають канонічні npm-шляхи; smoke-тест перевіряє, що обидві команди з’являються після встановлення архіву.
- Потрібен Node.js 22 або новіший; незалежний holdout і прослуховування аудіо лишаються окремими етапами оцінювання.

## 0.13.0 — 2026-11-12

- Числова нормалізація захищає версії, URL, email, телефонні рядки й невалідні дати; родовий числівник узгоджується з жіночими одиницями (`до однієї гривні`).
- Спільний tokenizer використовується в плануванні, аудиті й evaluation; scorer перевіряє кожне входження, зайві/відсутні слова й неправильні/додаткові наголоси окремо.
- TSV-лексикон відхиляє акут на приголосній, дублікати та невідповідні форми; `Lexicon.explain()` показує категорію й джерело. Додано опційний `stress.trace` по входженнях.
- Маніфест хешує runtime-модулі разом із ресурсами, тому зміни логіки скидають кеш синтезу навіть до bump версії.
- `prepareMany` застосовує ручні рішення `paragraph:offset` навіть без LLM; `PrepareResult` звітує про окремі нерозв'язані входження. Лексикон має пріоритет над загальними контекстними правилами.
- Додано точні fixtures нормалізації й документацію holdout/сліпого аудіювання; останній регресійний прогін: 28/28 рядків зі збереженою послідовністю слів, 100,0% precision, 97,0% recall і 98,5% F1. Це не незалежна оцінка якості.
- Shared `loadResources()` for CLI and integrations: bundled defaults, local overrides,
  immutable resource snapshots, source/file manifest and content fingerprint; refresh on file changes.
- `prepareMany().decisions` now uses occurrence IDs (`paragraph:UTF16Offset`), not words.
  Each repeated homograph can receive a different decision. Unknown-word LLM guessing
  now requires `resolveUnknown: true`; long prompts are split, and callers can keep failed
  batches unresolved instead of aborting. Explicit caller choices remain authoritative.
- Manual acute/plus-before stress is converted for the target engine; unsupported
  engines receive clean text. Resolver requests support cancellation.
- Dictionary downloads pin the source commit and SHA-256, install atomically and
  retain the previous binary by content hash; local TSV files are never overwritten.
- Audit exports every unresolved occurrence with sentence context. Evaluation counts
  repeated words separately, requires all expected marks, and labels the existing gold corpus as regression data.
- Dictionary building rejects stress marks on consonants; malformed rows in existing binaries
  are ignored and reported instead of reaching TTS as confident predictions.
- Project lexicons accept project/canonical-name/status metadata; `draft` and `rejected`
  entries remain reviewable but do not affect output. The shared tokenizer now covers stress,
  audit, evaluation and duration planning.
- CI validates the package installed from its npm archive and runs data checks without the
  large dictionary. The stricter scorer reports 100.0% precision / 97.0% recall on the
  28-row regression corpus; this is not held-out or audio evidence.

## 0.12.0 — 2026-11-12

- `scripts/audit.mjs` — аудит реальних текстів: частка наголошених слів по файлах
  і список того, що лишилось без наголосу.
- `CONTRIBUTING.md`: формати лексикону й контекстних правил, як перевіряти зміни.

## 0.11.0 — 2026-11-12

- `prev2`/`next2` у контекстних правилах: «два великі міста» тепер визначається,
  навіть коли між числівником і словом стоїть прикметник.
- Виправлено узгодження після 2–4: «два міста́», «два се́ла», «дві ві́йни» —
  це називний множини, а не родовий однини («до мі́ста» лишається родовим).
- Золоте правило для «ро́ки / роки́»: після 2–4 — тільки ро́ки, в інших
  контекстах обидва нормативні; скорер приймає обидва (два акути в слові).
- Золотих речень 28, точність 100%, повнота 97,7%, F1 98,7%.

## 0.10.0 — 2026-11-12

- **Контекстні правила для омонімів** (`lexicon/context.tsv`, `ContextRules`): сусіднє
  слово вирішує прочитання — «три ро́ки», «на горі́», «п'ять років тому́», «той са́мий».
  Умови `prev:`/`next:`/`prev~`/`next~`/`first`/`last`/`*`, іменовані набори `@gen`, `@loc`.
  Правила детерміновані, лежать у TSV і не потребують коду для доповнення.
- Омоніми, розв'язані контекстом, зникають зі списку на перевірку (`homographs`).
- `stressify` повертає `contextual` — скільки слів вирішив контекст.
- Ефект: повнота на золотому наборі 92,4% → **97,1%**, F1 96,0% → **98,6%**;
  на corpus омонімів 30 → **9**, покриття 89,6% → **96,7%**.
- Лексикон: проєктні імена з відмінками (Соломія, Дике Поле, Січ).

## 0.9.0 — 2026-11-12

- `lexicon/common.tsv` — слова, де словник дає рідкісний варіант, а загальне
  значення однозначне (по́вість, яку́, до́сі, дя́кую, рі́зні).
- `Lexicon.loadAll()` — злиття кількох лексиконів.
- Золотий набір оновлено за нормативними рішеннями: **точність 100%, повнота 90,5%**
  (було 84,8%). Решта помилок — справжні омоніми.

## 0.8.0 — 2026-11-12

- **Золотий набір** `evaluation/gold.tsv` (20 речень) і скорер `scripts/eval.mjs`:
  точність, повнота, F1 за тегами, список помилок у `evaluation/report.json`.
- Базовий стан: точність 97,8%, повнота 82,9%; основні втрати — омоніми,
  які рушій свідомо не вгадує.
- `npm run eval` і крок у CI.

## 0.7.0 — 2026-11-12

- **Темп відкалібровано на живому аудіо**: 125 слів/хв (62 слова за 30,3 с у tts-uk)
  замість вгаданих 150. Оцінка тривалості більше не додає паузи вдруге.
- **Емфаза в плані**: заперечення, контраст і оклик позначаються `emphasis`,
  у SSML — `<emphasis level="moderate">`.
- `scripts/calibrate-pace.mjs` — виміряти темп будь-якого рушія на своєму аудіо.

## 0.6.0 — 2026-11-12

- **Суфіксна модель** у словнику: 61 429 суфіксів, поріг упевненості 70%.
  Закриває слова, для яких не знайшовся стем (`діджиталізація` → `діджиталіз+ація`).
  На held-out вибірці — 82% точності на 30,8% слів.
- **`planSpeech()`** — план мовлення: межі речень і підрядних частин, паузи,
  тип речення й оцінка тривалості. `renderPlan()` віддає SSML із `<break/>`
  або звичайний текст.
- Формат словника v3 (UATS3) із вбудованою суфіксною моделлю (ліниве завантаження).
- `scripts/bench-perf.mjs`: завантаження 19 мс, 5400 слів за 13 мс (~420 тис. слів/с).

## 0.5.0 — 2026-11-12

- **Дефісні слова**: кожна частина наголошується окремо (`пів-України` → `пів-Укра+їни`).
- **Морфологічний фолбек**: слово успадковує наголос від спільного стема
  (`ковбасити` → `ковб+асити`). На held-out вибірці — 98% точності на 14,5% слів.
- **Слова поза словником через LLM**: `resolveUnknown()` питає індекс наголошеної
  голосні, перевіряє, що це справді голосна, і застосовує як `overrides`.
- `stressify()` приймає `overrides` і `inferFromStem`, повертає `inferred`.

## 0.4.0 — 2026-11-12

- Словник: пошук у `~/.local/share/ua-tts-text`, `UA_TTS_HOME`, `--dict`, `UA_TTS_DICT`.
- Новий бін `ua-tts-text-fetch-dict` — словник однією командою, без шляху в `node_modules`.
- Профілі `gemini-tts`, `cartesia`, `vosk-tts` (нормалізація без позначок наголосу).
- Повідомлення про відсутній словник тепер підказує команду, а не шлях у кеш `npx`.

## 0.2.0 — 2026-11-12

Перший публічний реліз.

### Ядро

- `normalize()`: роки з відмінком, дати (обидва формати й «1-го»), діапазони з родовим
  відмінком, порядкові з суфіксами (`5-й`, `2-га`, `3-тє`), відсотки, одиниці, валюта,
  масштаби (`тис.`, `млн`, `млрд`), довгі числа по цифрах, співвідношення (`50/50`),
  скорочення, пунктуація під TTS.
- `StressDictionary`: бінарний словник на 2 835 696 словоформ, двійковий пошук по UTF-8.
- `stressify()`: `+` перед голосною, `+` після, акут або нічого; омоніми, варіанти
  й складні слова з двома наголосами розрізняються.
- `render()`: профілі `tts-uk`, `holos-voice`, `silero`, `rhvoice`, `styletts2`,
  `piper-medium`, `piper-high`, `elevenlabs-v4`, `edge-tts`, `azure`, `plain`.
- `lexicon`: 84 власні назви, пріоритет над словником.
- `lint()`, `homographs()` з контекстом, `reviewPrompt()`, `parseDecisions()`,
  `applyDecisions()`.

### CLI

- `--engine`, `--dict`, `--lexicon`, `--decisions`, `--json`.
- `scripts/fetch-dict.mjs` — завантаження й збірка словника однією командою.

### Скіл

- `skills/ua-voiceover-prep/SKILL.md` — формат Agent Skills, перевірений у Claude Code,
  Codex і DSH.

### Відоме

- `piper-high` не приймає наголоси: espeak-ng вирішує їх сам і відкидає позначки.
- Латинські назви не транслітеруються, лише потрапляють у звіт.
