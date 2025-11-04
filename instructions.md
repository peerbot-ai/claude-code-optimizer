# Token Optimization Instructions

## Report Format

Each session contains numbered tool calls with timing and token usage:
```
Session 2024-12-17_10-45-23 (35m 42s)
1. Read: [+0s t=0] packages/gateway/src/interactions.ts (812 lines)
💭 [+3s in=89t out=8t]
```

Each tool call is formatted as: `N. ToolName: [metadata] details`, where metadata includes timing (+Xs since previous action) and tool-specific fields. For Bash commands, fields include exit=N (only shown when non-zero for failures), cmd=N (command token count), and out=N (output token count), followed by the truncated command. Read/Write/Edit tools show token counts and file ranges. Task tools show subagent type and description.

**Thinking blocks** (💭) indicate Claude deliberating/reviewing between actions. Sequences with thinking blocks typically involve decision-making and should NOT be merged into automated scripts. Only suggest combining sequences WITHOUT thinking blocks, as these represent mechanical, repeatable workflows.

## Category 1: Quick Commands

Detect config: package.json scripts, pyproject.toml [tool.scripts], Makefile targets (default: Makefile)

Look for patterns like:
- **Lines 4-7 repeated across sessions**:
  ```
  4. Bash: [+1s t=8] make build-packages
  5. Bash: [+8s t=16] docker compose restart gateway
  6. Bash: [+1s t=17] sleep 5
  7. Bash: [+6s t=23] docker compose logs gateway --tail=50
  ```
  → Combine: `make build-packages && docker compose restart gateway && sleep 5 && docker compose logs --tail=50`
    Saves: ~190 tokens per use (4 calls → 1 call)

- **Git workflow pattern**:
  ```
  12. Bash: [+0s t=45] git status
  13. Bash: [+1s t=46] git diff --stat
  14. Bash: [+1s t=47] git log -5 --oneline
  ```
  → Combine: `git status && git diff --stat && git log -5 --oneline`

**WARNING: Don't combine sequences with long thinking blocks:**
```
23. Bash: git status
💭 [+2s in=66t out=12t]
24. Bash: git diff
💭 [+3s in=2389t out=8t]
25. Bash: git commit -m "fix"
```
Thinking blocks (💭) indicate Claude is reviewing/deciding. These sequences need human judgment and should NOT be automated.

Find patterns (flexible count, default 3). First AskUserQuestion option: confirm/change save location.

## Category 2: Scripts

Detect scripts dir: scripts/, bin/, tools/ (default: ./scripts/). Language from existing (default: bash).

Look for patterns like:
- **Worker logs pattern with different thread IDs**:
  ```
  8. Bash: [+0s t=30] docker ps --filter "name=worker-1762140643"
  9. Bash: [+2s t=32] docker logs worker-1762140643-abc --tail=50
  10. Bash: [+1s t=33] docker logs worker-1762140643-abc | grep "error"
  ```
  → Script: `worker-logs.sh THREAD_ID [TAIL] [PATTERN]`
    Saves: ~150 tokens per use (3 calls → 1 call)

- **Slack test workflow**:
  ```
  30. Bash: [+0s t=120] ./scripts/slack-qa-bot.js "test message"
  31. Bash: [+1s t=121] sleep 15
  32. Bash: [+16s t=137] docker compose logs gateway --tail=30
  33. Bash: [+2s t=139] ./scripts/slack-thread-viewer.js "URL"
  ```
  → Script: `slack-test.sh MESSAGE [WAIT] [THREAD_URL]`

**REQUIRED FOR EACH SCRIPT:**
1. **Show --help output** - Include the script's help text showing:
   - Usage syntax
   - All parameters and options
   - Example usage

2. **Explain reasoning** - For each script, clearly explain:
   - Why this script is useful (what problem it solves)
   - How it reduces token usage (specific workflow it replaces)
   - When to use it (use cases and scenarios)
   - Token savings breakdown (per-use and total savings)

Example format:
```markdown
### Script: gateway-logs.js

**Why this is useful:**
This script consolidates the repetitive 3-step workflow of filtering Docker containers by gateway name, fetching logs, and grepping for errors. Instead of 3 separate Bash calls that each require token overhead, you get a single parameterized command that handles all three steps.

**Token savings:**
- Before: 3 Bash calls × ~190 tokens = ~570 tokens per use
- After: 1 script call × ~120 tokens = ~120 tokens per use
- Savings: ~450 tokens per use × 40 occurrences = ~18,000 tokens total

**Usage (--help output):**
```
Usage: gateway-logs.js [OPTIONS] [PATTERN]

Options:
  --tail <N>      Number of log lines to show (default: 50)
  --follow        Follow log output
  --help          Show this help message

Arguments:
  PATTERN         Optional grep pattern to filter logs

Examples:
  gateway-logs.js --tail 100
  gateway-logs.js "error"
  gateway-logs.js --follow "warning"
```

**When to use:**
- Debugging gateway service issues
- Monitoring gateway errors in real-time
- Tracing specific error patterns across gateway logs
```

Find patterns (flexible count based on what's in the report). First AskUserQuestion option: confirm/change scripts directory.

## Category 3: File Refactorings

Look for patterns like:
- **Consecutive reads of related files**:
  ```
  1. Read: [+0s t=0] src/interactions.ts (812 lines)
  2. Read: [+2s t=2] src/types.ts (203 lines)
  3. Read: [+1s t=3] src/custom-tools.ts (156 lines)
  ```
  → Merge into single file (saves ~380 tokens per read cycle - 3 reads become 1)

- **Large file with scattered edits**:
  ```
  15. Read: [+0s t=50] src/processor.ts (1500 lines)
  16. Edit: [+5s t=55] src/processor.ts[L234-L240]
  17. Edit: [+3s t=58] src/processor.ts[L1289-L1295]
  18. Edit: [+2s t=60] src/processor.ts[L567-L580]
  ```
  → Split into modules (saves re-reading 1500 lines for small edits)

**REQUIRED FOR EACH REFACTORING:**
1. **Explain reasoning** - For each refactoring suggestion, clearly explain:
   - Why this refactoring is useful (what problem it solves)
   - How it reduces token usage (specific workflow it optimizes)
   - Token savings breakdown (per-read/edit cycle and total savings)
   - Implementation approach (how to merge/split files, what to consider)
   - Potential trade-offs (code organization, maintainability, etc.)

2. **Show concrete examples** - Include:
   - Current file structure and access patterns
   - Proposed file structure
   - Before/after comparison of token usage
   - Frequency of the pattern (how often files are accessed together)

Example format:
```markdown
### Refactoring: Merge co-accessed files

**Files to merge:**
- `src/interactions.ts` (812 lines)
- `src/types.ts` (203 lines)
- `src/custom-tools.ts` (156 lines)

**Why this is useful:**
These three files are consistently read together in sequence (found in 23 sessions). Each read operation requires token overhead for the file path, metadata, and content. By merging them into a single `src/core.ts` file, we eliminate 2 read operations per access cycle, reducing both token count and API round-trips.

**Token savings:**
- Before: 3 Read calls × ~190 tokens = ~570 tokens per access cycle
- After: 1 Read call × ~190 tokens = ~190 tokens per access cycle
- Savings: ~380 tokens per cycle × 23 occurrences = ~8,740 tokens total

**Implementation approach:**
1. Create `src/core.ts` combining all three files with clear section comments
2. Update imports across the codebase
3. Consider namespace exports to maintain API compatibility

**Trade-offs:**
- Pros: Reduced token usage, fewer file operations, faster context loading
- Cons: Larger file size (may hit token limits if file grows too large), potential merge conflicts
- Recommendation: Only merge if files are consistently accessed together (>80% of the time)
```

Find patterns. Show files, frequency, and total savings with full explanations.

## Rules

- Generate suggestions based on patterns found in report (flexible count, quality over quantity)
- Calculate impact: occurrences × tokens_per_use
- Example: "Pattern found 23 times × ~190 tokens = ~4,370 tokens total savings"
- Use multiSelect: true for all AskUserQuestion calls
