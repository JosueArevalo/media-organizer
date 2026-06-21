# Contributing to Media Organizer

Thanks for taking the time to improve Media Organizer.

## Before you start

- Check existing issues and pull requests before opening a duplicate.
- Open an issue before starting a large feature or architectural change.
- Keep changes small, focused, and aligned with the local-first workflow.
- Never include personal media, local paths, credentials, or generated state in a contribution.

Repository architecture and implementation guidance live in [AGENTS.md](AGENTS.md) and the [architecture documentation](docs/ARCHITECTURE.md).

## Local setup

Follow the platform instructions in the [README](README.md#-platform-setup), then create a branch and install the locked dependencies:

```bash
npm ci
npm run setup:check
```

## Quality checks

Before opening a pull request, run:

```bash
npm run build
npm test
npm run test --workspace apps/web
```

Explain the user impact of the change and include tests for changed behavior. Changes involving filesystem writes, processing jobs, or persisted state must remain safe to resume and retry.

## Licensing contributions

Media Organizer is licensed under the [MIT License](LICENSE).

By submitting a contribution, you confirm that you have the right to submit it and agree that your contribution will be licensed under the MIT License. You retain copyright in your contribution; no copyright assignment or Contributor License Agreement is required.
