# xhs-parser

Netlify serverless function that parses Xiaohongshu (XHS / RedNote) share links into structured JSON. Accepts a XHS URL (full link, short link, or bare note ID) and returns the note's title, description, author, images, video URL, interaction counts, and tags.

## Tech Stack

- **Runtime:** Node.js 20+ (Netlify Functions v2)
- **Language:** TypeScript (strict mode, ESM modules)
- **Deployment:** Netlify (serverless functions with esbuild bundler)
- **No external dependencies** beyond `@netlify/functions` — uses native `fetch`.

## Directory Structure

```
xhs-parser/
├── netlify/
│   └── functions/
│       ├── parse.ts       # Netlify function handler (HTTP entry point)
│       ├── parser.ts      # Core parsing logic (URL extraction, HTML parsing)
│       └── types.ts       # TypeScript interfaces
├── netlify.toml           # Netlify configuration
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

## Local Development

```bash
npm install
netlify dev
```

The function is available at `http://localhost:8888/.netlify/functions/parse`.

## Deployment

Push to GitHub. Netlify auto-deploys from the connected branch.

Manual deploy: `netlify deploy --prod`

## API Documentation

### Endpoint

```
GET/POST /.netlify/functions/parse
```

### Request

**GET** — pass URL as query parameter:
```
GET /.netlify/functions/parse?url=https://www.xiaohongshu.com/explore/6456789abcdef012345abcde
```

**POST** — pass URL in JSON body:
```json
{ "url": "https://www.xiaohongshu.com/explore/6456789abcdef012345abcde" }
```

Accepted URL formats:
- Full URL: `https://www.xiaohongshu.com/explore/{noteId}`
- Short link: `https://xhslink.com/xxxxx`
- Bare note ID: `6456789abcdef012345abcde`
- Share text containing any of the above (e.g. copied from XHS app)

### Response

**Success (200):**
```json
{
  "success": true,
  "data": {
    "id": "6456789abcdef012345abcde",
    "title": "Note title",
    "description": "Note description text",
    "author": {
      "name": "Author Name",
      "id": "user123",
      "avatar": "https://..."
    },
    "images": ["https://...", "https://..."],
    "video": "https://..." | null,
    "likes": 1234,
    "collects": 567,
    "comments": 89,
    "tags": ["tag1", "tag2"],
    "url": "https://www.xiaohongshu.com/explore/6456789abcdef012345abcde"
  }
}
```

**Error responses:**

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_URL` | 400 | Missing or unrecognized URL |
| `NOT_FOUND` | 404 | Note does not exist |
| `PARSE_ERROR` | 422 | Could not parse note data from page |
| `RATE_LIMITED` | 429 | XHS is rate-limiting requests |
| `NETWORK_ERROR` | 502 | Failed to reach XHS |

All error responses have shape: `{ "success": false, "error": "...", "code": "..." }`

All responses include CORS headers (`Access-Control-Allow-Origin: *`) for iOS Shortcuts and browser compatibility.

## Code Conventions

- TypeScript strict mode
- ESM modules (`"type": "module"` in package.json)
- No comments unless explaining a non-obvious workaround
- Prefer native APIs over external libraries
