# Source Files

This directory contains TypeScript source files for extensions and modifications to the Playwright MCP server.

## network.ts

The `mcp/browser/tools/network.ts` file extends the network tools with HAR export functionality:
- `browser_save_network_har` - Saves network requests as HAR 1.2 format files

For the core Playwright MCP source code, please refer to the [Playwright monorepo](https://github.com/microsoft/playwright) at `packages/playwright/src/mcp/`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for more details on contributing to the core Playwright MCP.
