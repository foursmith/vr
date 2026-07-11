import antfu from "@antfu/eslint-config"

export default antfu(
  {
    react: false,
    solid: false,
    markdown: false,
    lessOpinionated: true,
    stylistic: {
      quotes: "double",
    },
    ignores: [
      "public/**",
    ],
    rules: {
      "node/prefer-global/process": "off",
      "style/eol-last": "off",
      "antfu/curly": "error",
      "curly": "off",
      "style/brace-style": ["error", "1tbs"],
      "eslint-comments/no-unlimited-disable": "off",
      "no-console": "off",
      "antfu/no-top-level-await": "off",
      "unused-imports/no-unused-vars": "warn",
      "no-control-regex": "off",
    },
  },
)
