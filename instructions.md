# Token Optimization Instructions

## Report Format

Each session contains numbered tool calls with timing and cost:
```
Session 2024-12-17_10-45-23 (35m 42s, $0.42)
1. Read: [+0s t=0 $0.0240] packages/gateway/src/interactions.ts (812 lines)
2. Read: [+2s t=2 $0.0060] packages/gateway/src/types.ts (203 lines)
3. Edit: [+5s t=7 $0.0045] packages/gateway/src/interactions.ts[L234-L245]
4. Bash: [+1s t=8 $0.0015] make build-packages (exit: 0)
💭 [+3s in=89t out=8t $0.0004]
5. Bash: [+2s t=16 $0.0012] docker compose restart gateway (exit: 0)
```

Each tool call is formatted as: `N. ToolName: [metadata] details`, where metadata includes timing (+Xs since previous action), tool-specific fields, and cost ($X.XXXX). For Bash commands, fields include exit=N (only shown when non-zero for failures), cmd=N (command token count), and out=N (output token count), followed by the truncated command. Read/Write/Edit tools show token counts and file ranges. Task tools show subagent type and description.

**Thinking blocks** (💭) indicate Claude deliberating/reviewing between actions. Sequences with thinking blocks typically involve decision-making and should NOT be merged into automated scripts. Only suggest combining sequences WITHOUT thinking blocks, as these represent mechanical, repeatable workflows.

## Category 1: Quick Commands

Detect config: package.json�scripts, pyproject.toml�[tool.scripts], Makefile�targets (default: Makefile)

Look for patterns like:
- **Lines 4-7 repeated across sessions**:
  ```
  4. Bash: [+1s t=8 $0.0015] make build-packages
  5. Bash: [+8s t=16 $0.0012] docker compose restart gateway
  6. Bash: [+1s t=17 $0.0008] sleep 5
  7. Bash: [+6s t=23 $0.0020] docker compose logs gateway --tail=50
  ```
  � Combine: `make build-packages && docker compose restart gateway && sleep 5 && docker compose logs --tail=50`
  � Saves: $0.0055 per use (4 calls � 1 call)

- **Git workflow pattern**:
  ```
  12. Bash: [+0s t=45 $0.0010] git status
  13. Bash: [+1s t=46 $0.0012] git diff --stat
  14. Bash: [+1s t=47 $0.0010] git log -5 --oneline
  ```
  � Combine: `git status && git diff --stat && git log -5 --oneline`

**WARNING: Don't combine sequences with thinking blocks:**
```
23. Bash: git status
💭 [+2s in=66t out=12t $0.0003]
24. Bash: git diff
💭 [+3s in=89t out=8t $0.0004]
25. Bash: git commit -m "fix"
```
Thinking blocks (💭) indicate Claude is reviewing/deciding. These sequences need human judgment and should NOT be automated.

Find 5+ patterns. First AskUserQuestion option: confirm/change save location.

## Category 2: Scripts

Detect scripts dir: scripts/, bin/, tools/ (default: ./scripts/). Language from existing (default: bash).

Look for patterns like:
- **Worker logs pattern with different thread IDs**:
  ```
  8. Bash: [+0s t=30 $0.0012] docker ps --filter "name=worker-1762140643"
  9. Bash: [+2s t=32 $0.0015] docker logs worker-1762140643-abc --tail=50
  10. Bash: [+1s t=33 $0.0018] docker logs worker-1762140643-abc | grep "error"
  ```
  � Script: `worker-logs.sh THREAD_ID [TAIL] [PATTERN]`
  � Saves: $0.0045 per use

- **Slack test workflow**:
  ```
  30. Bash: [+0s t=120 $0.0025] ./scripts/slack-qa-bot.js "test message"
  31. Bash: [+1s t=121 $0.0008] sleep 15
  32. Bash: [+16s t=137 $0.0020] docker compose logs gateway --tail=30
  33. Bash: [+2s t=139 $0.0030] ./scripts/slack-thread-viewer.js "URL"
  ```
  � Script: `slack-test.sh MESSAGE [WAIT] [THREAD_URL]`

Find 5+ patterns. First AskUserQuestion option: confirm/change scripts directory.

## Category 3: File Refactorings

Look for patterns like:
- **Consecutive reads of related files**:
  ```
  1. Read: [+0s t=0 $0.0240] src/interactions.ts (812 lines)
  2. Read: [+2s t=2 $0.0060] src/types.ts (203 lines)
  3. Read: [+1s t=3 $0.0045] src/custom-tools.ts (156 lines)
  ```
  � Merge into single file (saves $0.0105 per read cycle - 3 reads become 1)

- **Large file with scattered edits**:
  ```
  15. Read: [+0s t=50 $0.0450] src/processor.ts (1500 lines)
  16. Edit: [+5s t=55 $0.0020] src/processor.ts[L234-L240]
  17. Edit: [+3s t=58 $0.0022] src/processor.ts[L1289-L1295]
  18. Edit: [+2s t=60 $0.0018] src/processor.ts[L567-L580]
  ```
  � Split into modules (saves re-reading 1500 lines for small edits)

Find 5+ patterns. Show files, frequency, and total savings.

## Rules

- Minimum 5 suggestions per category
- Calculate impact: occurrences � cost_per_use
- Example: "Pattern found 23 times � $0.0055 = $0.1265 total savings"
- Use multiSelect: true for all AskUserQuestion calls
