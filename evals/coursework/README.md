# Coursework release evaluation

Run `npm run eval:release` from the repository root after `npm ci`. This checks installation ownership, runtime startup wiring, packaged resources, and the packaged connector. It writes a fresh `dev/.state/coursework-evals/run-*/report.json`. Model behavior is **NOT RUN** by default.

Run `npm run eval:release -- --model` to additionally use the signed-in Codex account with `gpt-6-astra` and medium reasoning. This spends account usage. It starts four isolated synthetic workspaces and one turn per scenario, with a 180-second timeout per turn. Native runtime setup has its own connection timeout. No Canvas connection or production coursework is used. Network and Canvas actions are excluded by the evaluation prompt; runtime approval requests are declined. This is not a network isolation sandbox. Existing native Codex settings and installed skills still apply.

The scenarios cover missing required readings, original rubric criteria and weights, an actual Markdown artifact, and conflicting source notes. The runner uses the real companion `CodexRuntime`, checks native `skills/list` discovery at the installed path, and requires an observed successful command reading the applicable `SKILL.md`. These are explicit skill-invocation tests, not a measure of automatic skill selection. Each scenario starts a fresh main session to avoid cross-scenario contamination; product sessions remain persistent.

Reports separate deterministic plumbing from model results. Behavioral results apply narrow assertions to actual model replies, saved file bytes, and tool evidence. They are repeatable smoke evaluations, not a semantic judge or a release-quality guarantee. Inspect each answer and synthetic `eval-events.json` before accepting a release, especially rubric reasoning and source uncertainty. A correct answer through an unrecognized tool path can fail an assertion and needs manual adjudication; do not silently loosen checks to make a run pass.

Reports retain the requested model/effort, discovered skill path, elapsed time, checks, answer, and native token usage when provided. Monetary cost is unavailable and recorded as null, never zero. A timeout or provider failure is ERROR; an assertion failure is FAIL. Skipped model runs remain NOT RUN. A failed run exits nonzero. The local ignored report directory may contain tool transcripts and inherited runtime context; do not publish it without inspection.

## Maintaining procedures

The three procedures in `companion/bundled-skills/` are developer-maintained. They cite available sources, expose missing evidence, and use installed authoring tools. They do not learn or import third-party procedures.

Startup installs them in `<Canvasdoc root>/.agents/skills/`, using Codex's native discovery. Descriptions enter the native skill catalog; complete procedures are loaded on demand. `.canvasdoc/bundled-skills.json` records hashes of files installed by Canvasdoc. Only a file matching its recorded hash can be updated. Unknown files, edited files, and skill-directory symlinks are preserved; unsafe parent symlinks fail setup. Removing a user-edited bundled file lets the next startup install the current bundle. Unrelated skills are untouched. Disabled skills stay under native Codex configuration control.

`node scripts/package-cli.mjs` includes and verifies the actual skill assets. No additional authoring dependencies are required by the bundle. Native contract references are the installed Codex 0.154.0 app-server and `companion/vendor/harness-codex/protocol.ts` (`skills/list`, `SkillsListParams`, `SkillMetadata`, and skill `UserInput`).
