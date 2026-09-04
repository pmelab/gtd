// Plain `.mjs` (not `.ts`) so `scripts/inline-web-client.mjs` — a bare `node`
// script with no TypeScript transform — can import it directly, the same
// module both it and `src/serve/Server.ts` share, so the two never drift
// apart the way two independently-typed copies of this regex would.
export const SCRIPT_TAG_PATTERN = /<script type="module" src="\.\/main\.js"><\/script>/
