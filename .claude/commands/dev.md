---
disable-model-invocation: true
---

Run the full development validation pipeline: typecheck, then test, then build. Stops on first failure.

```bash
npx tsc --noEmit && npm test && npm run build
```
