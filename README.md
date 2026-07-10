# CEH Quiz Offline PWA

Question bank extracted from:

`Certified_Ethical_Hacker_312-50v13_Real_Questions.pdf`

## Parsed dataset

- Questions: **965**
- IDs: **1–965**
- `Correct Answer`: **302**
- `Suggested Answer`: **663**
- Questions with embedded PDF images: **6**
- Parser validation warnings: **0**

Image-backed questions:

`2, 38, 44, 76, 257, 280`

## Features

- Training mode with instant validation
- Random exam mode
- Wrong-answer retry queue
- Bookmarks
- Question and answer shuffling
- Exam timer
- Local-only progress in `localStorage`
- Progress export/import as JSON
- PWA service worker for offline cache
- No backend and no external CDN dependencies

## Important: how to use it on iPhone

A Service Worker requires the app to be opened from HTTPS (or localhost during development).
Do **not** just open `index.html` as a local file and expect PWA installation to work.

### Fast deployment options

1. Put the contents of this directory on any static HTTPS hosting.
2. Open the HTTPS URL in Safari on the iPhone.
3. Wait until the first page fully loads.
4. Safari → Share → Add to Home Screen.
5. Launch the installed CEH Quiz icon once while online.
6. After the assets are cached, use the quiz offline.

Static hosting examples: GitHub Pages, Cloudflare Pages, Netlify, your own nginx.

### Local desktop test

From this directory:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/
```

For installation on a real iPhone, use HTTPS hosting.

## Data format

Each object in `questions.json` has the following shape:

```json
{
  "id": 257,
  "topic": 1,
  "question": "What is the following command used for?",
  "answers": {
    "A": "...",
    "B": "...",
    "C": "...",
    "D": "..."
  },
  "correctAnswer": "C",
  "answerSource": "Correct",
  "sourcePage": 317,
  "image": "images/q257.png"
}
```

The `image` property exists only for questions with an embedded image in the original PDF.
