import next from "eslint-config-next"

/**
 * ESLint config.
 *
 * `npm run lint` had no config file before this, so it always failed.
 */
const config = [
  {
    ignores: [".eve/**", ".output/**", ".next/**", "node_modules/**"],
  },
  ...next,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Deliberate empty catch blocks are common here: analytics, Slack name
      // lookups, and attachment uploads must never fail a turn.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // `agent/` is server-side agent code, not React. The Next.js preset's React
    // rules produce false positives on framework APIs that happen to be named
    // like hooks — eve's sandbox `use()`, for instance.
    files: ["agent/**/*.ts", "evals/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]

export default config
