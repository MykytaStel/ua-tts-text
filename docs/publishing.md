# Публікація

## Що готове

- Пакет збирається через `pnpm build`; `pnpm prepublishOnly` перевіряє збірку,
  тести, дані й установлення з локального npm-архіву.
- Smoke-перевірка встановленого архіву перевіряє API та доступні CLI-команди.
- Ліцензія MIT, `LICENSE` на місці.
- Скіл лежить у `skills/ua-voiceover-prep/SKILL.md` (формат Agent Skills).

## Стан

- [x] GitHub: https://github.com/MykytaStel/ua-tts-text (публічний, топіки додано)
- [x] CI: тести зі словником і без нього
- [x] skills.sh: https://www.skills.sh/mykytastel/ua-tts-text/ua-voiceover-prep (проіндексовано автоматично)
- [x] npm: https://www.npmjs.com/package/ua-tts-text (`latest` — `0.30.0`, перевірено 2026-11-22)
- [x] Вихідний код `0.25.0` злитий у `main` у PR #10
- [x] Код handoff `0.26.0` злитий у PR #11 і включений у наступний кандидат; окремої публікації `0.26.0` не було
- [x] Тег `v0.30.0` і npm `gitHead` вказують на `05b976f`, коміт злиття виправлень із PR #14.
- [x] Створено [GitHub Release](https://github.com/MykytaStel/ua-tts-text/releases/tag/v0.30.0). Перевірено встановлення `ua-tts-text@0.30.0` з npm у чистий проєкт.
- [x] `0.35.0` — локальний кандидат пройшов `pnpm prepublishOnly` і `node scripts/eval.mjs --strict` (217 тестів, 15 script checks, 36/36 fixtures, packed-install smoke; regression set 28 речень).
- [ ] Після публікації оновити `@cf/providers` і `@cf/film` у pnpm workspace та звірити тег, npm `gitHead`, integrity і встановлення з registry.
- Незалежний holdout і сліпе аудіо не зібрані; реліз не заявляє покращення точності наголосів чи якості аудіо. Зібрати їх перед будь-якою такою заявою.

## Крок 1. GitHub (зроблено)

```bash
gh repo create MykytaStel/ua-tts-text --public \
  --description "Український текст до озвучки: числа, дати, наголоси під конкретний TTS-рушій" \
  --source . --push
```

Після цього — топіки, щоб каталоги побачили проєкт:

```bash
gh repo edit MykytaStel/ua-tts-text \
  --add-topic ua-tts --add-topic agent-skills --add-topic dsh-plugin \
  --add-topic ukrainian --add-topic tts --add-topic text-normalization
```

## Крок 2. npm

```bash
npm publish
```

Якщо npm попросить повторну автентифікацію або одноразовий код, заверши її в
CLI та після публікації перевір версію й `latest` dist-tag через `npm view`.

`prepack` збирає `dist` автоматично; словник у пакет не входить — його тягне
`npx ua-tts-text` → `scripts/fetch-dict.mjs` (75 МБ, 2,84 млн словоформ).

Для кожного релізу запускай `pnpm prepublishOnly`, оновлюй changelog і створюй
release tag після злиття перевіреного commit у `main`.

## Крок 3. Каталоги скілів

- skills.sh підхопив репозиторій автоматично, без заявки: сторінка з'явилася за кілька
  хвилин після публікації.
- Каталог DSH збирає плагіни за топіком `dsh-plugin`.

## Крок 4. Стаття

Чернетка: `docs/dou-article.md`. Незаповнені місця позначені `TODO` — їх треба закрити
реальними сценаріями фабрики й результатом прослуховування.

## Чого не робити

- Не публікувати `data/` (словник) у git — 75 МБ, і ліцензія словника живе окремо.
- Не додавати в пакет `node_modules` або `samples/`.
