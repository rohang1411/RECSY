/**
 * Prettier config. Kept minimal and opinionated — the only project-specific
 * tweak is the Tailwind plugin so utility classes stay sorted canonically.
 */
/** @type {import("prettier").Config} */
const config = {
  semi: true,
  singleQuote: true,
  jsxSingleQuote: false,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindFunctions: ['cn', 'cva', 'clsx', 'twMerge'],
};

export default config;
