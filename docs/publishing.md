# Публікація

## Що готове

- Пакет збирається: `pnpm build` → `dist/`, `npm pack` дає 36 кБ, 35 файлів.
- Перевірено встановленням тарболу в чисту теку: `npx ua-tts-text --engine tts-uk` працює.
- Ліцензія MIT, `LICENSE` на місці.
- Скіл лежить у `skills/ua-voiceover-prep/SKILL.md` (формат Agent Skills).

## Крок 1. GitHub

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

Потрібен вхід (зараз `npm whoami` дає 401):

```bash
npm login
npm publish
```

`prepack` збирає `dist` автоматично; словник у пакет не входить — його тягне
`npx ua-tts-text` → `scripts/fetch-dict.mjs` (75 МБ, 2,84 млн словоформ).

## Крок 3. Каталоги скілів

- skills.sh підхоплює публічні репозиторії зі `SKILL.md`; вручну нічого надсилати не треба,
  але варто перевірити пошук за `ukrainian`.
- Каталог DSH збирає плагіни за топіком `dsh-plugin`.

## Крок 4. Стаття

Чернетка: `docs/dou-article.md`. Незаповнені місця позначені `TODO` — їх треба закрити
реальними сценаріями фабрики й результатом прослуховування.

## Чого не робити

- Не публікувати `data/` (словник) у git — 75 МБ, і ліцензія словника живе окремо.
- Не додавати в пакет `node_modules` або `samples/`.
