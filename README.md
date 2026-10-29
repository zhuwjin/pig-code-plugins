# Pig Code Plugins

Public plugin packages for the Pig Code marketplace.

## Repository layout

- `index.json` is the versioned marketplace catalog.
- `packages/<package-id>/` contains one plugin package.
- Every catalog entry records the package identity, version, directory, whole-package digest, and each file's size and SHA-256.

Pig Code downloads files into a staging directory, verifies every file and the whole-package digest, and only then replaces an installed package. New and updated packages remain disabled until the user enables their exact digest in Settings → Plugins.

## DeepSeek Search

`com.deepseek.websearch` provides the `DeepSeekSearch` tool. Its package-owned API key and default result count are managed only in the plugin details configuration view; it contributes no standalone settings page. It calls `POST https://api.deepseek.com/v1/tools/search` with `need_content: false`.

API reference: https://api-docs.deepseek.com/zh-cn/api/search
