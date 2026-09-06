# Tanva desktop capability bundle

This directory is the install-time slot for audited desktop skills and isolated runtimes.

To stage the user-supplied reference package, run:

```text
node scripts/importDesktopBundle.mjs --source /path/to/reference/app --dry-run
node scripts/importDesktopBundle.mjs --source /path/to/reference/app --force
```

The importer copies the isolated runtimes and MCP skill dependencies, removes
generated Python caches, and writes a manifest with the imported file count.
Tanva validates executable paths and MCP configuration before starting a service.
