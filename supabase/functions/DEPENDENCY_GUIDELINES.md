# Supabase Edge Functions - Dependency Guidelines

## ⚠️ DO NOT USE CDN Imports in Production

The following import sources are **BLOCKED** for production edge functions:

| ❌ Blocked | ✅ Use Instead |
|-----------|----------------|
| `https://esm.sh/...` | `npm:package@x.y.z` |
| `https://cdn.skypack.dev/...` | `npm:package@x.y.z` |
| `https://unpkg.com/...` | `npm:package@x.y.z` |
| `https://cdn.jsdelivr.net/...` | `npm:package@x.y.z` |

### Why?

CDN imports (especially esm.sh) can timeout during Supabase's bundle generation phase:
- esm.sh/Cloudflare returns 524 timeout → bundler waits/retries → Supabase hits 60s timeout
- Error: `"Bundle generation timed out"` or `524 <unknown status code>`
- This happens unpredictably based on CDN load

### Best Practices

1. **Use `npm:` specifiers** - resolved locally via Deno's npm compatibility
2. **Pin exact versions** - `@2.39.3` not `@2` (avoids resolution variance)
3. **Run Docker Desktop** - local bundling is faster and more reliable
4. **Run import checker before deploy**: `.\supabase\functions\check-imports.ps1`

### Approved Import Patterns

```typescript
// ✅ Good - npm with pinned version
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

// ✅ Good - Deno standard library (stable)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ❌ Bad - CDN import (can timeout)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ❌ Bad - Unpinned version
import { createClient } from "npm:@supabase/supabase-js@2";
```

### Current Function Bundle Sizes

| Function | Size | Status |
|----------|------|--------|
| check-job | ~982KB | ✅ OK |
| run-job | ~1.3MB | ✅ OK |
| create-job | ~200KB | ✅ OK |

Supabase Edge Functions support up to 2MB bundles (soft limit ~4MB).

---

*Last updated: 2026-02-05*
