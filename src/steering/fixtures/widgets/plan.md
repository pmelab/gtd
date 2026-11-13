# Plan: rate limiting

The API has no limit today. This plan adds one per token.

## 🔘 Where is the counter stored?

Redis is already deployed; memory is lost on restart.

- [ ] Redis
- [ ] In process memory
- [ ] ✏️

### ☑️ Which endpoints?

- [x] `/search`
- [ ] `/upload`

## 🔍 Middleware

Adds the limiter in front of every route.

- [ ] ./src/middleware/limit.ts#1-40
- [ ] ./src/app.ts#12-14 — wires it in

## ❔ Ship behind a flag?

- [ ] Yes
