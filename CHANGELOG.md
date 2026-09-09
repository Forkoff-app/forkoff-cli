# Changelog

All notable changes to the forkoff CLI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).
Each release is tagged `v<version>` in git and published to npm.

## [Unreleased]

## [1.2.0] - 2026-09-10

### Added
- `forkoff remote` command group — route Claude Code through a self-hosted gateway so a laptop can use a Claude account stored on your own server, with the full local terminal experience:
  - `remote login [--url] [--username] [--password]` — authenticate against the gateway, store a revocable device key in the OS keychain
  - `remote signup [--url] [--username] [--password] [--code]` — create a gateway account with an invite code
  - `remote start [--minimal]` — inject `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` into `~/.claude/settings.json` (atomic write, one-time backup, prior values snapshotted) so every new claude session routes through the gateway
  - `remote stop` — restore the exact previous settings
  - `remote status` — state reconciliation plus live gateway health
  - `remote logout` — stop, delete the stored key, clear login state
- `forkoff config --reset` now refuses while remote mode is active so Claude settings can always be restored.

## [1.1.6] - 2026-08-30

### Changed
- SEO: optimized npm description and keywords for discoverability.

## [1.1.5] and earlier
Pre-changelog history; see git log.
