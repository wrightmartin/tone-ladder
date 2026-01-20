# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tone Ladder is a static (HTML/CSS/JS) hue-shift tonal ramp generator.

**Usage Notice:** This repository is public for inspection purposes only. It is not open source and no license is granted for use, modification, or distribution.

## Constraints

- No frameworks, no JS libraries, no CSS frameworks
- Relative paths only
- Modular color algorithm in `assets/js/colorModels/…` (app.js must not embed algorithm logic)

## Architecture

### History & Undo
- Store generated `rampHexes` in history
- Undo is in-memory only (not persisted)
- "X" remove button only appears in Recent section
- "Clear all" requires confirmation prompt ("Are you sure?")
