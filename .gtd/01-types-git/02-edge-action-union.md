# Add `squashCommit` to the `EdgeAction` union

File: `src/Machine.ts`

## Change

In the `EdgeAction` union (~line 190–205), after the `done` variant:

```typescript
  | { readonly kind: "done" }
```

Add:

```typescript
  | {
      readonly kind: "squashCommit"
      readonly squashBase: string
      readonly commitMessage: string
    }
```

The full union bottom becomes:

```typescript
  | { readonly kind: "commitReview" }
  | { readonly kind: "done" }
  | {
      readonly kind: "squashCommit"
      readonly squashBase: string
      readonly commitMessage: string
    }
```

No other changes to this file in this task.
