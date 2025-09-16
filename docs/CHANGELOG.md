# Changelog

All notable changes to this project are documented here.

This file follows the Keep a Changelog style, and the project aims to use Semantic Versioning.

## [Unreleased]
- 

## [v0.1.0] - 2025-09-16

### Added
- Center-based smart placement for new images:
  - `generate`: place new image to the right by 522px from cached center.
  - `edit`: place new image below by 522px from cached center.
- Cached image debug panel (`CachedImageDebug`): shows cached image ID, prompt, preview, center `(cx, cy)`, and latest mode (`generate|edit|blend|analyze|chat`).
- Event-driven updates:
  - `cachedImageChanged` fired when cache updates or clears.
  - `contextModeChanged` fired when recording an operation (mode change).
- Context cache extended with `latestBounds` and `latestLayerId`.
- When an image is placed on canvas or selected, cache is updated with its latest bounds.

### Changed
- Quick upload flow now accepts `smartPosition` and prioritizes it for precise placement.

### Notes
- If no cached position exists, the first image falls back to the default center `(0, 0)`.
- Layer info is optional for placement; calculations use the center point from bounds.

[v0.1.0]: https://github.com/litai12/Tanva/releases/tag/v0.1.0

