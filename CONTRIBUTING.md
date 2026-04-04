# Contributing to Proofmark

## Development Setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Copy environment file
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL

# Push database schema
npm run db:push

# Start dev server
npm run dev
```

## Code Style

Code style is enforced automatically:

- **Prettier** formats all code on save and pre-commit
- **ESLint** enforces TypeScript strict rules, no `any` types, no bare `console.log`
- **TypeScript** runs in strict mode with `noUncheckedIndexedAccess`

Run `npm run validate` before pushing. Pre-commit hooks run Prettier and ESLint automatically.

## Pull Request Process

1. Create a branch from `main`
2. Make your changes
3. Run `npm run validate` — all checks must pass
4. Open a PR using the template
5. Describe what changed and how you tested it

### PR Checklist

- [ ] `npm run validate` passes
- [ ] No `any` types introduced
- [ ] No `console.log` in production code (use `logger` from `~/lib/logger`)
- [ ] Complex logic has comments explaining _why_, not _what_
- [ ] New environment variables added to `.env.example`

## Code Guidelines

### Naming

- **Files**: kebab-case (`document-editor.tsx`, `field-runtime.ts`)
- **Functions/variables**: camelCase
- **Types/interfaces**: PascalCase
- **Constants**: UPPER_CASE for module-level constants

### Comments

Write comments that explain _why_, not _what_. If the function name and types already explain what happens, a comment adds noise. Save comments for:

- Non-obvious business rules
- Workarounds with context on why they exist
- Algorithmic decisions that aren't self-evident

### Imports

- Use `type` imports for type-only imports: `import type { Foo } from "./bar"`
- Import from `~/` path alias (maps to `src/`)

### Error Handling

- Use `logger.info/warn/error` from `~/lib/logger` instead of `console.log`
- `logger.info` is suppressed in production

## Premium Features

The `premium/` directory is gitignored and not part of the OSS distribution. If you're working on premium features:

- Premium code lives in `premium/` and is dynamically imported
- The OSS build must work without `premium/` present
- Feature gates use `isFeatureEnabled()` from `~/lib/feature-access`
- Never hard-import from `~/premium/*` in `src/` — always use dynamic imports with fallbacks

## Testing

```bash
npm run test          # Run all tests
npm run test:watch    # Watch mode
```

Tests use Vitest. Test files live in `__tests__/` directories alongside the code they test.

## Questions?

Open an issue if something is unclear. We're happy to help.
