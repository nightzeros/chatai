import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const [publishWorkflow, fallbackWorkflow, packageJson] = await Promise.all([
  readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8"),
  readFile(path.join(root, ".github/workflows/publish-npm-token-fallback.yml"), "utf8"),
  readFile(path.join(root, "package.json"), "utf8"),
]);

assert.match(publishWorkflow, /environment:\s*npm/m, "publish-npm.yml must use environment: npm");
assert.match(
  publishWorkflow,
  /id-token:\s*write/m,
  "publish-npm.yml publish job must request id-token: write for OIDC",
);
assert.doesNotMatch(
  publishWorkflow,
  /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\.NPM_TOKEN/,
  "publish-npm.yml must not use long-lived npm tokens",
);
assert.match(
  publishWorkflow,
  /publish-npm-packages\.mjs --dry-run/,
  "publish-npm.yml must support dry-run publish script mode",
);
assert.match(
  publishWorkflow,
  /publish-npm-packages\.mjs --publish/,
  "publish-npm.yml must use explicit --publish mode",
);
assert.doesNotMatch(
  publishWorkflow,
  /pull_request:/,
  "publish-npm.yml must not trigger on pull_request",
);
assert.match(
  publishWorkflow,
  /github\.repository == 'nightzeros\/chatai'/,
  "publish-npm.yml must guard against fork/untrusted repository publishes",
);
assert.match(
  publishWorkflow,
  /node-version:\s*"22\.14"/,
  "publish-npm.yml must pin Node 22.14+ for Trusted Publishing",
);
assert.match(
  publishWorkflow,
  /npm@11\.5\.1/,
  "publish-npm.yml must install npm 11.5.1+ for Trusted Publishing",
);
assert.match(
  publishWorkflow,
  /verify-npm-registry\.mjs/,
  "publish-npm.yml must run post-publish registry verification",
);
for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) {
  assert.match(
    publishWorkflow,
    new RegExp(`^\\s+${name}:\\s*\\S`, "m"),
    `publish-npm.yml validate job must set ${name} so \`pnpm build\` can collect page data`,
  );
}

assert.match(
  fallbackWorkflow,
  /if:\s*false/,
  "publish-npm-token-fallback.yml job must remain disabled by default",
);
assert.doesNotMatch(
  fallbackWorkflow,
  /tags:\s*\n\s*-\s*"v\*"/,
  "publish-npm-token-fallback.yml must not trigger on v* tags",
);

const scripts = JSON.parse(packageJson).scripts;
assert.equal(
  scripts["packages:publish:dry-run"],
  "node scripts/publish-npm-packages.mjs --dry-run",
  "Root package.json must expose packages:publish:dry-run",
);
assert.equal(
  scripts["packages:publish"],
  "node scripts/publish-npm-packages.mjs --publish",
  "Root package.json must expose packages:publish",
);
assert.equal(
  scripts["packages:verify-registry"],
  "node scripts/verify-npm-registry.mjs",
  "Root package.json must expose packages:verify-registry",
);

console.log("[ci] npm Trusted Publishing workflow gates are configured.");
