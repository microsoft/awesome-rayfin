export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      [
        "events-app",
        "field-engineer",
        "gallery",
        "ci",
        "scripts",
        "docs",
      ],
    ],
  },
};
