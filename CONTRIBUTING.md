# Як долучитися

Проєкт тримається на трьох речах: словнику, лексиконі й контекстних правилах.
Додати слово чи правило може будь-хто — коду для цього не треба.

## 1. Власна назва або нове слово

`lexicon/names.tsv` — топоніми, прізвища, бренди, імена персонажів.
Формат: `слово <TAB> наголошена форма <TAB> категорія <TAB> джерело`.

```
Соломійка	Соломі́йка	ім’я персонажа	manual: головна героїня
```

Акут (´) стоїть **після** наголошеної голосної. Якщо назва складена — два акути:
`Кам’яне́ць-Поді́льський`.

Відмінювані форми додавайте окремими рядками — лексикон шукає точну форму:
`Соломійка`, `Соломійки`, `Соломійці`, `Соломійку`, `Соломійкою`, `Соломійко`.

## 2. Загальне слово, де словник дає рідкісний варіант

`lexicon/common.tsv` — те саме, але для звичайних слів, де друге прочитання
архаїчне або належить іншому слову:

```
повість	по́вість	загальне	«пові́сть» — рідкісне дієслово «повісти»
```

Правило: додавайте лише тоді, коли впевнені, що друге прочитання справді рідкісне.
Справжні омоніми (`за́мок`/`замо́к`) сюди **не** додаються — їх вирішує контекст.

## 3. Контекстне правило

`lexicon/context.tsv` — коли наголос вирішує сусіднє слово.

```
# слово   наголошене   умова                         джерело
роки      ро́ки         prev:@few                     «три ро́ки»
 Rokи      роки́         *                             типове прочитання
міста     мі́ста         prev:@gen                     «до мі́ста»
міста     міста́         prev:@few                     «два міста́»
міста     міста́         prev2:@few & prev~і|ий|ій     «два великі міста́»
```

| Умова | Значення |
|---|---|
| `prev:а|б` | попереднє слово — одне зі списку |
| `next:а|б` | наступне слово — одне зі списку |
| `prev2:` / `next2:` | слово через одне (числивник + прикметник + іменник) |
| `prev~суфікс` | попереднє слово закінчується на суфікс |
| `next~суфікс` | наступне слово закінчується на суфікс |
| `first` / `last` | слово перше / останнє у частині речення |
| `*` | завжди; ставте останнім серед правил слова |

Умови з'єднуються через ` & `. Сусідом вважається лише слово в тій самій частині
речення: кома, тире чи крапка розривають зв'язок. Набори оголошуються рядком
`@gen = до|від|з|без` і використовуються як `prev:@gen`.

Правила одного слова перевіряються згори вниз, спрацьовує перше.

## Проєктне читання скорочення або терміна

Для точних фраз, які треба замінити перед синтезом, використовуйте
`~/.local/share/ua-tts-text/normalization.tsv` або `UA_TTS_NORMALIZATION`:

Формат: `збіг<TAB>читання<TAB>джерело<TAB>статус`. Наприклад,
`АТБ<TAB>а-те-бе<TAB>затверджено редактором проєкту<TAB>verified`.

Колонки: літеральний збіг, готове читання, джерело й статус (`verified`, `draft`
або `rejected`). Регістр не враховується, пробіли всередині фраз нормалізуються,
а з перекривних збігів береться найдовший. Читання не обробляється вдруге
нормалізатором; для активного синтезу приймаються тільки `verified` рядки.
Пізніший локальний файл перекриває такий самий збіг із пакета.

## 4. Перевірка

```bash
node scripts/eval.mjs        # золотий набір: точність, повнота, F1
node scripts/audit.mjs --dir ~/шлях/до/сценаріїв   # реальні тексти
```

`eval` показує, чи не зламали ви щось; `audit` — які слова у ваших текстах
лишились без наголосу. Друге — найкраще джерело нових рядків лексикону.

Якщо слово спірне — додайте речення в `evaluation/gold.tsv` і поясніть рішення
в `evaluation/review.md`. Так само зроблено для «ро́ки/роки́», «мі́ста/міста́».

## 5. Чого не робити

- Не вгадуйте наголос «на слух» без джерела — краще лишити слово омонімом.
- Не додавайте правило, яке перекриває інше без прикладу в золоті.
- Не комітьте `data/` — словник завантажується командою `npx ua-tts-text-fetch-dict`.

## Context review reports

Generate a review sheet and machine-readable occurrence records from a directory
of UTF-8 `.txt` or `.md` scripts:

```bash
node scripts/audit.mjs --dir /path/to/scripts --review /tmp/real-review.md --json /tmp/real-review.json
```

`--top` limits the number of distinct unresolved words (default 40); every
unresolved occurrence of those words is included. Counts are occurrences, not
the number of files containing a word. The audit uses `tts-uk` stress markers.

Contexts are normalized TTS sentences. IDs contain the relative source filename
and a UTF-16 offset into the prepared output, not a source-file line number.
Resolved occurrences of the same spelling are excluded. Fill in a complete
accented word, rather than a vowel letter, because a word can repeat that vowel.
The report does not automatically modify dictionaries or decide pronunciation.

Use reviewed sentences as regressions. Keep separate scripts held out when
measuring generalization; explicit stress coverage alone does not measure
pronunciation accuracy. Output files should be outside the input directory so
they are not included in later audits.
