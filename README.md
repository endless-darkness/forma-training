# Forma

A private workout tracker you can host on GitHub Pages. Log sets, reps, load, and reps in reserve; review your training; and get understandable suggestions for your next session.

Forma is a dependency-free web app: plain HTML, CSS, and JavaScript. It needs no paid service, account system, API key, or application server.

## What the first version does

- Starts workouts from upper/lower templates and records working sets and warm-ups.
- Keeps an unfinished workout in this browser so you can return to it.
- Tracks recent workouts and sets by primary muscle group.
- Suggests progression from your completed workout history.
- Uses a brief manual check-in to add context to today's training.
- Exports and imports local backups.
- Supports installation and offline use after the app has loaded successfully.

The adaptive guidance uses transparent rules, not a trained AI model or a chat service. There is no Apple Health integration in this web version. It does not measure muscle growth or claim to find the optimal program for every person.

## Run locally

Install Node.js 22 or later, then run these commands from the project folder:

```sh
npm start
```

Open [the local preview](http://127.0.0.1:4173). No dependency installation is needed. Use this local server instead of opening `index.html` directly, because JavaScript modules and service workers need an HTTP origin.

```sh
npm test
npm run build
```

Tests run with Node's built-in test runner. The build copies only the site assets into `_site/` and gives the service worker a version derived from their content.

## Publish free with GitHub Pages

1. Create a public GitHub repository and upload this project, including `.github/workflows/deploy.yml`. Use `main` as the default branch.
2. In the repository, open **Settings → Pages** and select **GitHub Actions** as the source.
3. Push a commit to `main`, or open **Actions → Test and deploy Forma → Run workflow**.
4. After the workflow succeeds, open the URL shown by the deployment and in **Settings → Pages**.

The workflow tests the app, prepares `_site/`, and deploys that folder. Pull requests run the checks without deploying. Relative asset paths support both an account site and a repository site such as `https://USERNAME.github.io/REPOSITORY/`.

GitHub Free supports Pages for public repositories. This publishes the app's source code and static assets; it does not publish workouts entered in a visitor's browser. See [GitHub's Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Your data and backups

Workout data stays in the browser's local storage. Forma does not send your workouts to GitHub, an AI provider, or an analytics service. Hosting still involves ordinary requests for the site's public files.

There is no automatic sync between devices, browsers, or different site addresses. Clearing site data, using temporary browsing, or losing the device can remove your records. Use **Settings & backups** to keep a backup file somewhere you control. Backups contain your workout information; keep them private and do not commit them to the repository.

## Install and use offline

On iPhone, open the published site in Safari and use **Share → Add to Home Screen**. On browsers that support app installation, use their install option. After one successful online load, the app's shell is cached for offline use. A first visit still needs a connection.

The service worker caches only the app's static files, scoped to this installation. It does not cache workout exports or third-party requests. An updated version waits for the app's refresh action, so a deployment does not unexpectedly replace an active workout. Service workers require HTTPS or a local development origin. See [the service worker API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).

## How suggestions work

The progression engine suggests a small load increase only after the last two completed exposures reach the top of an exercise's rep range on every working set, at the same load and with at least one rep in reserve. Warm-ups do not count. Incomplete or invalid working sets block an increase. The suggestion remains editable so it can match your equipment and how warm-ups feel.

Volume totals count valid, completed working sets from today and the preceding six local calendar dates. Each set is assigned to its exercise's primary muscle, so these totals do not claim to capture all secondary-muscle work. Manual energy, soreness, and pain check-ins provide context; they are not a measured recovery score.

These are conservative starting rules that should evolve with real use and validation. A future native iPhone companion could add Apple Health inputs, and a separately designed AI layer could explain recommendations, but neither is required to use this version.

## Files

- `index.html`, `css/styles.css`, `js/app.js`: interface and interactions.
- `js/data.js`: exercise library and starting templates.
- `js/engine.js`: progression and training summaries.
- `js/storage.js`: local persistence and backup validation.
- `sw.js`, `manifest.webmanifest`, `icons/`: installation and offline shell.
- `scripts/`: local preview and static packaging.
- `.github/workflows/deploy.yml`: checks and GitHub Pages publishing.
