# Contributing to VizFlow

Thanks for your interest in contributing! VizFlow is an open-source Visual Studio Code extension focused on CSV/TSV exploration, transformation and visualization. We welcome bug reports, feature requests, documentation improvements, tests, and code contributions.

Please follow these guidelines to make contribution smooth and easy to review.

1. Code of conduct
------------------
Be respectful and constructive. Follow project etiquette: explain your reasoning, be patient in reviews, and keep discussions focused on technical merits.

2. Reporting bugs & requesting features
--------------------------------------
- Before opening an issue, search existing issues to avoid duplicates.
- For bugs, include:
  - a short, descriptive title
  - steps to reproduce (sample CSV if relevant)
  - expected vs actual behavior
  - VS Code version and OS
  - relevant logs from `Help → Toggle Developer Tools` or the Output panel
- For feature requests, describe the problem you want solved and a suggested approach or example workflow.

3. Development setup
--------------------
1. Clone the repository:

```bash
git clone https://github.com/ESAditya1729/VizFlow.git
cd VizFlow
npm install
```

2. Launch the Extension Development Host in VS Code (press `F5`).
3. Run linting and tests locally:

```bash
npm run lint
npm test
```

4. Branches & commits
---------------------
- Create a descriptive branch name, e.g. `feature/rbql-export`, `fix/csv-parser-edgecase`.
- Keep commits small and focused. Use present-tense, short commit messages and include context in the body when necessary.
- Include the Co-authored-by footer if you followed pair-programming with the Copilot/assistant tooling.

5. Pull requests
----------------
- Open a PR against `main` (or the default branch). In the PR description include:
  - what the change does and why
  - screenshots or demo GIFs for UI changes
  - any migration or compatibility notes
  - tests added or manual test steps
- PRs should pass CI linting and tests. Reviewers will ask for changes where appropriate.

6. Tests
--------
- Add unit tests for new logic in `services/` and `engine/` where applicable.
- Keep tests deterministic; use small sample CSV fixtures stored under `test/fixtures/`.

7. WebViews & security
----------------------
- WebViews run in a browser context. Avoid interpolating untrusted data directly into HTML. JSON-serialize dataset samples and use safe DOM APIs.
- Use a strict Content Security Policy (CSP) and nonces for scripts. Prefer loading assets via `panel.webview.asWebviewUri()`.

8. Style & linting
------------------
- Follow the repository ESLint rules. Run `npm run lint` before submitting.
- Keep changes backwards-compatible where reasonable.

9. Release process
------------------
- Update `CHANGELOG.md` with a short summary of changes under the `Unreleased` heading.
- Bump the version in `package.json` for releases and create a tag.

10. Need help?
--------------
Open an issue labeled `help wanted` with a clear description of what you need and someone from the community or the maintainer will respond.

Thanks again — your contributions make VizFlow better for everyone!