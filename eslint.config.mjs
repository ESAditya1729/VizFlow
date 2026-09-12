import globals from "globals";

export default [
  { ignores: [".vscode-test/**", "node_modules/**"] },
  {
    // Node / extension host files
    files: ["**/*.js"],
    ignores: ["media/**"],
    languageOptions: {
        globals: {
            ...globals.commonjs,
            ...globals.node,
            ...globals.mocha,
        },

        ecmaVersion: 2022,
        sourceType: "commonjs",
    },

    rules: {
        "no-const-assign": "error",
        "no-this-before-super": "error",
        "no-undef": "error",
        "no-unreachable": "error",
        "no-unused-vars": "warn",
        "constructor-super": "error",
        "valid-typeof": "error",
    },
  },
  {
    // Webview / browser scripts bundled into media/
    files: ["media/**/*.js"],
    languageOptions: {
        globals: {
            ...globals.browser,
            acquireVsCodeApi: "readonly",
        },
        ecmaVersion: 2022,
        sourceType: "script",
    },
    rules: {
        "no-const-assign": "error",
        "no-this-before-super": "error",
        "no-undef": "error",
        "no-unreachable": "error",
        "no-unused-vars": "warn",
        "constructor-super": "error",
        "valid-typeof": "error",
    },
  }
];