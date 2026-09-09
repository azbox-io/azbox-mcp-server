# azbox-mcp-server

An [MCP](https://modelcontextprotocol.io) server for [AZbox](https://azbox.io).
It lets a coding agent read your project's translation keys without leaving the
editor: find the key behind a string you can see in the UI, list what is still
untranslated in a language, check whether a key already exists before adding a
duplicate.

Works with any MCP client. Set up below for Claude Code and Cursor.

## Install

```bash
npm install -g azbox-mcp-server
```

Node 18 or newer.

### Claude Code

```bash
claude mcp add azbox --env AZBOX_TOKEN=your-api-key -- npx -y azbox-mcp-server
```

### Cursor

In `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "azbox": {
      "command": "npx",
      "args": ["-y", "azbox-mcp-server"],
      "env": { "AZBOX_TOKEN": "your-api-key" }
    }
  }
}
```

The API key comes from the AZbox dashboard. `AZBOX_API_KEY` also works, and
`AZBOX_BASE_URL` points the server at a different API host.

A key issued by the dashboard starts with `azb_live_` and is sent in the
`x-api-key` header, so it never reaches a server or proxy log. Keys can be
revoked and can be scoped to a single project — worth doing here, since an
agent only ever needs to read the project it is working on. Older credentials
(the account identifier earlier AZbox libraries used) still work and are sent
the way that API expects, but they cannot be revoked and they open the whole
account. Replace them.

## Tools

All six are read-only. Nothing this server does can change your project.

| Tool | What it answers |
|---|---|
| `azbox_list_projects` | Which projects does this account have, and in which languages |
| `azbox_get_project` | What is this project called and which language codes are valid |
| `azbox_list_categories` | How is this project organised |
| `azbox_list_keywords` | Give me a page of keys and their translations |
| `azbox_search_keywords` | Which key holds this text, or which keys start with `checkout.` |
| `azbox_find_untranslated` | What is still missing in French |

Every listing tool takes `limit` and `offset` and reports `total_count`,
`has_more` and `next_offset`, and every one accepts
`response_format: "markdown" | "json"`.

### What it deliberately does not do

- **No writing.** Keys are created in the dashboard or by importing a file; the
  AZbox API is read-only for keywords, so there is nothing to expose.
- **No translating.** The API has a `POST /v1/translation/translate` that
  proxies DeepL using AZbox's own key, with no per-project scoping. An agent
  looping over it would spend the account's DeepL quota, so this server does
  not offer it.

## Things worth knowing

- **The key you use in code is `key`.** The API's `id` field is an internal
  document identifier, generated automatically. It means nothing to your
  application.
- **`translation` is `null` when a key has no text yet** in the language you
  asked for. The API omits the field entirely; the server normalises it.
- **An empty language is not an error.** The API answers `404` when a project
  has no keys in a language; the server returns an empty list.
- **Keys come back sorted**, so repeated calls are stable.
- **Responses are capped** at 25,000 characters and paginated by default,
  because a real project has thousands of keys and dumping them all leaves the
  agent no room to work. Narrow down with `azbox_search_keywords`.

## Development

```bash
npm install
npm run build
npm test      # builds, then drives the server over stdio against a fake API
npm run inspect   # opens the MCP Inspector against the built server
```

`npm test` does a full MCP handshake on stdio, lists the tools, calls every one
of them and checks the edge cases that actually bite: a project that does not
exist, a language that does not exist, a language with no keys, pagination, and
that nothing but protocol traffic ever reaches stdout.

## Licence

MIT
