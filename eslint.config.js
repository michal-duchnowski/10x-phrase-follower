import { includeIgnoreFile } from "@eslint/compat";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

// File path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic],
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
  },
});

const jsxA11yConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [jsxA11y.flatConfigs.recommended],
  languageOptions: {
    ...jsxA11y.flatConfigs.recommended.languageOptions,
  },
  rules: {
    ...jsxA11y.flatConfigs.recommended.rules,
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// Node.js scripts configuration (for test scripts and utility scripts)
const nodeScriptsConfig = tseslint.config({
  files: ["src/test/scripts/**/*.js", "scripts/**/*.js", "*.config.mjs", "*.config.js"],
  languageOptions: {
    globals: {
      // Node.js globals
      console: "readonly",
      process: "readonly",
      Buffer: "readonly",
      __dirname: "readonly",
      __filename: "readonly",
      global: "readonly",
      // Node.js built-in modules
      crypto: "readonly",
      fs: "readonly",
      path: "readonly",
      // Web APIs available in Node.js 18+
      fetch: "readonly",
      TextEncoder: "readonly",
      TextDecoder: "readonly",
      URL: "readonly",
      URLSearchParams: "readonly",
    },
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    "no-console": "off", // Console is expected in test/debug scripts
    "@typescript-eslint/no-unused-vars": "off", // Allow unused vars in test scripts
    "no-undef": "off", // We're defining globals manually
  },
});

// Ignore patterns for performance
const ignoreConfig = tseslint.config({
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.astro/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/*.bundle.js",
    "**/build/**",
    "**/.next/**",
    "**/.vercel/**",
    "**/.cache/**",
  ],
});

export default tseslint.config(
  ignoreConfig,
  includeIgnoreFile(gitignorePath),
  baseConfig,
  jsxA11yConfig,
  reactConfig,
  nodeScriptsConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginPrettier
);
