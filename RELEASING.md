# Releasing

One version at a time, in this order.

## 1. Prepare

- `npm run typecheck && npm test && npm run build`
- Bump `version` in `package.json`, `src/version.ts`, `server.json` (both the
  server version and the npm package version) and `packaging/manifest.json`.
- Add the entry to `CHANGELOG.md`. Unreleased fixes are squashed into one version
  and one entry, however many of them there are.

## 2. npm

The first publication of a package name is done by hand, since trusted publishing
cannot be configured against a name npm does not yet know:

```bash
npm publish --access public
```

Afterwards the `Publish` workflow does it, under the repository's OIDC identity,
with no token stored anywhere.

## 3. The tag

```bash
git tag v1.0.0 && git push origin v1.0.0
```

That triggers the publish workflow, the `.mcpb` bundle, and the GitHub release.

## 4. The MCP registry

The `Publish to MCP registry` workflow runs after a successful publish. It fills
in the bundle's hash and address from the release itself rather than from a value
committed by hand: that address carries a version number, and a hand-written one
survives a bump and makes the registry serve a bundle older than the one it
announces.

The registry caps a description at **100 characters** and refuses anything longer.

## 5. Glama

Indexing is automatic; the rest needs a signed-in session.

1. Claim the server. `glama.json` carries `maintainers: ["smeet666"]` as proof.
2. Set the build spec.
3. Press **Build** on its own, then **Make Release**, entering the real version
   number. The combined button picks a number of its own.

## 6. Directories

- `punkpeye/awesome-mcp-servers`, by pull request.
- `mcp-marketplace.io`, which reads `LAUNCHGUIDE.md` at the root.
