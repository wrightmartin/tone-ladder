# Tone Ladder

Tone Ladder is a static web tool for generating painterly, hue-shifted tonal colour ramps. It produces artist-style value scales where warm light creates cool shadows (and vice versa), rather than naive lightness scaling. The algorithm operates in OKLCH colour space to ensure perceptually uniform results.

## What this project is (and is not)

- Static HTML, CSS, and JavaScript application
- No frameworks, no libraries, no server required
- Algorithm-focused: the core value is the hue-shift logic, not the interface
- **Not** a simple HSL lightness tool — those already exist

## Usage notice

This repository is public for inspection purposes only. No licence is granted for reuse, modification, or distribution.

## Running locally

Serve the repository root with any static file server.

Using Python:

```sh
python3 -m http.server 8000
```

Using Node (requires `http-server` package):

```sh
npx http-server -p 8000
```

Then open `http://localhost:8000` in a browser.

## Styles

SCSS source files live in `assets/scss/`. The compiled CSS is committed to `assets/css/styles.css` and served directly. Compile locally when making style changes:

```sh
sass assets/scss/styles.scss assets/css/styles.css
```

## Deployment

The site deploys as a GitHub Pages project site from the repository root.

- URL: `https://wrightmartin.github.io/tone-ladder/`
- All paths must be relative to ensure correct resolution

## Project structure

```
/
├── index.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── scss/
│   │   └── styles.scss
│   └── js/
│       ├── app.js
│       ├── storage.js
│       ├── history.js
│       └── colorModels/
│           ├── index.js
│           ├── convert.js
│           └── hueShift.js
├── CLAUDE.md
├── PLAN.md
└── README.md
```

The colour algorithm is isolated in `assets/js/colorModels/`. Application coordination, state management, and UI wiring live in `app.js`. Storage and history logic are separated into their own modules.

See PLAN.md for the authoritative design and implementation reference.
