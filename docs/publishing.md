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
- [x] npm: https://www.npmjs.com/package/ua-tts-text (`latest` — `0.15.0` за перевіркою 2026-11-14)
- [x] Git tag `v0.16.0` створений; публікацію `0.16.0` ще не підтверджено в npm

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
