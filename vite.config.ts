import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import * as R from "effect/Record";
import { defineConfig } from "vite-plus";

/** The Oxlint config shape the presets share, named without depending on `oxlint` directly. */
type OxlintConfig = typeof recommended;

/** `config` with every `warn` raised to `error`: this package has no warn tier. */
const atError = (config: OxlintConfig): OxlintConfig => ({
  ...config,
  rules: R.map(config.rules ?? {}, (setting) =>
    setting === "warn"
      ? "error"
      : Array.isArray(setting) && setting[0] === "warn"
        ? ["error", ...setting.slice(1)]
        : setting,
  ),
});

export default defineConfig({
  // Format with fixes, lint without: a type-aware autofix at commit time would
  // make the commit differ from the verified tree. Lint ignores some paths
  // (test/dist-consumer/), so an unmatched pattern is not an error.
  staged: {
    "*.{js,mjs,ts}": [
      "vp check --fix --no-lint",
      "vp check --no-fmt --no-error-on-unmatched-pattern",
    ],
    "*.{json,md}": "vp check --fix --no-lint",
  },
  run: {
    cache: true,
    tasks: {
      // The API reference the Pages workflow publishes. Examples are
      // rendered but not compiled (`tscExecutable: "true"` in docgen.json).
      "docgen:pages": { command: "docgen", cache: false },
      // The Effect-patched native `tsc` (`prepare`), which reports the Effect
      // diagnostics tsrs in `vp check` does not.
      check: "tsc -p tsconfig.json",
      build: "vp pack",
      // Writes coverage/coverage-final.json, which fallow reads for CRAP
      // scores. Vitest reads back its own `coverage/.tmp/`, so `coverage/`
      // is left out of the fingerprint or the task would never cache.
      "test:unit": {
        command: "vp test run --coverage",
        cache: { input: [{ auto: true }, "!coverage/**"] },
      },
      // Type-checks test/dist-consumer/ against the emitted declarations,
      // under both TS 7 (`tsc`) and TS 6 (`tsc6`).
      "check:dist": {
        command: [
          "tsc -p test/dist-consumer/tsconfig.json",
          "tsc6 -p test/dist-consumer/tsconfig.json",
        ],
        dependsOn: ["build"],
      },
      // TypeDoc fails on an undocumented export or an unresolved `{@link}`.
      docgen: "typedoc",
      // `--no-cache` leaves invalidation to the Vite+ task cache.
      fallow: {
        command: ["fallow dead-code --no-cache", "fallow dupes --no-cache --fail-on-issues"],
      },
      // `--complexity` skips git-churn hotspots, which the task cache can't
      // fingerprint.
      "fallow:health": {
        command: "fallow health --no-cache --complexity",
        dependsOn: ["test:unit"],
      },
      // Run by the pre-commit hook; reads the coverage map.
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["test:unit"],
        cache: false,
      },
      "changeset:version": {
        command: ["changeset version", "vp fmt"],
        cache: false,
      },
      // The release job's publish script (.github/workflows/release.yml),
      // after the build and `check:dist`: pnpm publishes the version unless
      // npm already has it (`-r` checks the registry; a plain publish would
      // re-send it), under OIDC trusted publishing; then `changeset git-tag`
      // tags it and reports the tag to `changesets/action` through
      // `CHANGESETS_OUTPUT`, which pushes it and creates the GitHub release.
      // Uncached, so it sees the full environment; a failed publish stops
      // before tagging.
      release: {
        command: [
          "vp pm publish -r --access public --no-git-checks -- --ignore-scripts",
          "changeset git-tag",
        ],
        dependsOn: ["check:dist"],
        cache: false,
      },
      // What `release` would publish, without publishing or tagging.
      "release:dry-run": {
        command: "vp pm publish -r --access public --dry-run --no-git-checks -- --ignore-scripts",
        dependsOn: ["check:dist"],
        cache: false,
      },
      // Everything CI runs, in order; `pnpm audit` needs the network.
      ci: {
        command: [
          "vp check",
          "vp run check",
          "vp run fallow",
          "vp run test:unit",
          "vp run fallow:health",
          "vp run build",
          "vp run check:dist",
          "vp run docgen",
          "pnpm audit --audit-level high",
        ],
        cache: false,
      },
    },
  },

  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    // Nothing here touches Node: the mechanisms run in a browser or Worker too.
    platform: "neutral",
    // One output file per module keeps each mechanism tree-shakeable.
    unbundle: true,
    dts: true,
    sourcemap: true,
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
      neverBundle: [/^node:/],
    },
  },

  lint: {
    // test/dist-consumer/ needs the built `dist/`; `check:dist` covers it.
    ignorePatterns: ["**/dist/**", "api-docs/**", "coverage/**", "test/dist-consumer/**"],
    extends: [atError(recommended), atError(effect.configs.recommended)],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      "effect/casting-awareness": "error",
      "effect/prefer-option-over-null": "error",
      "effect/no-unknown-parameters": "error",
      // Effect 4 marks much of `effect/http` and `@effect/vitest` unstable, so
      // this reports the pinned API rather than a defect. It stays a
      // suggestion in tsconfig.json's language-service options.
      "effecttsgo/unstable-api-usage": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
      "effect/no-conditional-empty-object-spread": "error",
      "effecttsgo/strict-effect-provide": "error",
      "effecttsgo/prefer-typed-schema-decoder": "error",
      "effecttsgo/schema-number": "error",
      "effecttsgo/schema-class-missing-brand": "error",
      "effect/effect-run-in-body": "error",
      // `_tag` is the discriminant of Effect's tagged unions (`Data.TaggedEnum`,
      // `Schema.TaggedError`); reading it is how tests and plain data name a
      // variant.
      "no-underscore-dangle": ["error", { allow: ["_tag"] }],
      "typescript/no-unsafe-type-assertion": "error",
      "typescript/no-unnecessary-type-parameters": "error",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expect*", "assert", "assert*"] },
      ],
      "vitest/no-standalone-expect": [
        "error",
        {
          additionalTestBlockFunctions: [
            "it",
            "it.each",
            "it.effect",
            "it.effect.each",
            "it.effect.skipIf",
            "it.live",
            "it.live.each",
            "it.live.skipIf",
          ],
        },
      ],
    },
    overrides: [
      // `Data.TaggedEnum` spells a variant without fields as `{}`; nothing
      // else stands in for it (`Record<string, never>` collides with `_tag`).
      {
        files: ["src/Auction.ts", "src/Draft.ts"],
        rules: {
          "effect/avoid-object-type": "off",
        },
      },
      {
        files: ["test/**"],
        rules: {
          // `@effect/vitest`'s `layer(...)` hands each block its own `it`.
          "no-shadow": ["error", { allow: ["it"] }],
        },
      },
    ],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  fmt: {
    ignorePatterns: ["**/dist/**", "api-docs/**"],
  },

  // Examples import the package by its public name, as a consumer would.
  resolve: {
    alias: {
      "@thomasfosterau/effect-choice": new URL("src/index.ts", import.meta.url).pathname,
    },
  },

  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      // `json` writes coverage-final.json for fallow.
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "examples/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
