# memory-worthydb

Repository scaffold for memory-related OpenClaw integration work. The tracked repo is intentionally minimal right now; large local experiments and vendor checkouts live under `do-not-commit/` and are not part of version control.

## Structure

```text
memory-worthydb/
├── README.md       # Project overview
├── AGENTS.md       # Agent instructions for this repo
├── do-not-commit/  # Local-only scratch work and external checkouts
└── .gitignore      # Ignore rules for local artifacts
```

## Development

Add project-specific build, test, and run commands here as the tracked codebase takes shape.

## Guidelines

- Do not commit anything under `do-not-commit/`.
- Prefer portable paths and repo-relative commands in checked-in files.
- Update `README.md` and this file when the tracked project structure becomes concrete.
