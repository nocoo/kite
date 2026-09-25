# Versioning and releases

The root `package.json` is the authoritative Kite version. npm maintains its
matching root entries in `package-lock.json`; do not introduce another lockfile.
CLI help, `--version`, the sidebar version pill and the collector health response
read the manifest directly. The same-origin `/api/live` route exposes the running
collector's version. API fields use `X.Y.Z`; UI, documentation, tags and release
names use `vX.Y.Z`. Event `schemaVersion` and the supported Pi version are separate
contracts, not copies of the Kite version.

## Prepare

1. Follow the requested version and the maintained `system0-github-versioning`
   procedure. Inspect the working tree, existing remote tags/releases and commits
   since the previous release before choosing the release contents.
2. Use npm to update the manifest and lockfile together, without creating a tag:
   `npm version patch --no-git-tag-version` for a patch, or replace `patch` with
   the explicitly requested version. Search for stale first-party versions.
3. Add the release's actual changes to root `CHANGELOG.md`. The first release
   uses the complete project history as its baseline.
4. Run `npm run check` and `npm run build`. When capture behavior changes, also
   run `python3 scripts/probe-collector.py`; when UI behavior changes, run the
   relevant browser checks described in the README. Preserve normal Git hooks.
5. Commit explicit paths, push the release commit, and inspect its `CI` workflow.
   CI installs from the npm lockfile and runs strict lint, types, coverage, build
   and built-CLI checks on Node.js 24 and 26. All four UT coverage metrics must
   remain at least 95%.

## Publish and verify

1. Create an annotated `vX.Y.Z` Git tag at the intended release commit and push
   it with Git. Never move a published tag. Check remote state before retrying
   an uncertain push or GitHub request.
2. Copy that version's changelog entry into a temporary notes file and publish
   with `gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file PATH`.
   The package is private; a GitHub source release does not publish to npm.
3. Verify the remote tag's commit, GitHub Release, and exact-commit/tag CI jobs.
   Inspect immediately and schedule a five-minute follow-up while verification
   remains pending. Resolve failures before claiming a verified release.
4. Build locally and restart the owned collector gracefully so its in-memory
   manifest matches the release. Keep the existing SQLite history. Vite dev
   reloads source; a preview server needs the new build and a restart.
5. Verify the installed CLI, sidebar and local endpoint:

   ```sh
   node dist/cli.js --version
   curl --fail --header 'x-kite-client: 1' https://kite.dev.hexly.ai/api/live
   ```

   The development domain uses the existing local Caddy mapping to port 7055.
   This project has no hosted production deployment or Worker. Do not infer
   deployment from an unrelated green workflow or a successful local build.
6. Record project release facts and evidence in nmem: version, commit, tag,
   Release URL, exact-revision CI and local runtime verification. Report any
   verification still pending explicitly.
