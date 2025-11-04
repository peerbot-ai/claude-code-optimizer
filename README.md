# Token optimization plugin for Claude Code

Analyzes your Claude Code conversation history to detect repetitive multi-step patterns. The tool:
1. Extracts and enriches tool call metadata with timing, token counts, and file ranges
2. Compresses session data with RLE for efficient pattern detection
3. Generates actionable optimization suggestions:
   - **Quick Commands**: One-liner chains for package.json/Makefile
   - **Parameterized Scripts**: Reusable workflows that handle different inputs
   - **File Refactorings**: Merge/split files accessed together to reduce token overhead

![Demo](demo.gif)

## Usage

### Claude Code Plugin

```bash
/plugin marketplace add peerbot-ai/claude-code-optimizer
/plugin install agent-trace-ops
```

After installing the plugin, use the `/plan` command for on-demand analysis:

```bash
/agent-trace-ops:plan
```

### CLI

```bash
npx agent-trace-ops
```
Install globally for repeated use:

```bash
npm install -g agent-trace-ops
ato --project-path=<path> --agent=claude
```

This will:
1. Check for existing analysis reports
2. Ask if you want to reuse or regenerate the report
3. Let you select which optimization categories to analyze:
   - Quick Commands (one-liner chains for package.json/Makefile)
   - Parameterized Scripts (reusable workflows)
   - File Refactorings (merge/split frequently accessed files)
4. Analyze patterns and generate optimization suggestions
5. Show helpers with potential token savings calculations

## How it works

Every conversation in Claude Code is saved as JSONL (JSON Lines) files in `~/.claude/projects/<hash>/`. The tool analyzes these sessions and generates a report:

```
## Sessions

### Session agent-567356cb [2025-11-04 03:15:59] (29s)
1. Read: [3106b] .zshrc[L1-L64]
💭 [+3s in=89t out=8t]
2. Edit: [+9s 1048b] settings.json[L1-L4], statusline-command.sh[L1-L31]
3. Read: [+1s 9069b] count_tokens.js[L1-L245]
💭 [+2s in=156t out=12t]
4. Edit: [+6s 740b] settings.json[L1-L4]
⏹️ MessageEnd [+4s in=12t out=45t]

### Session 396d2518 [2025-11-04 01:42:53] (2m 10s)
1. Bash: [cmd=96b out=177b] node index.js --project-path=$(pwd) --list
💭 [+2s in=45t out=6t]
2. Bash: [+4s cmd=97b out=1396b] node index.js --project-path=$(pwd) --print
⏹️ MessageEnd [+3s in=18t out=234t]
```

Claude inspects the behavioral data from it's own agent and suggests different optimizations.

### Example Optimizations

**Quick Commands** - Combine repeated bash sequences (package.json/Makefile):
```bash
# Detected pattern (found 23 times in sessions):
4. Bash: [+1s cmd=8b] make build-packages
5. Bash: [+8s cmd=16b] docker compose restart gateway
6. Bash: [+1s cmd=17b] sleep 5
7. Bash: [+6s cmd=23b] docker compose logs gateway --tail=50

# Suggested: Add to Makefile or package.json
make deploy-gateway  # Reduces 4 calls → 1 call
# Saves: ~190 tokens per use × 23 times = ~4,370 tokens total
```

**Parameterized Scripts** - Reusable workflows with different parameters:
```bash
# Detected pattern (found 15 times with different worker IDs):
8. Bash: [+0s cmd=30b] docker ps --filter "name=worker-1762140643"
9. Bash: [+2s cmd=32b] docker logs worker-1762140643-abc --tail=50
10. Bash: [+1s cmd=33b] docker logs worker-1762140643-abc | grep "error"

# Suggested script: ./scripts/worker-logs.sh
./scripts/worker-logs.sh 1762140643 50 "error"  # Reduces 3 calls → 1 call
# Saves: ~150 tokens per use × 15 times = ~2,250 tokens total
```

**File Refactorings** - Merge co-accessed files:
```bash
# Detected pattern (found 23 times):
1. Read: [+0s 6156b] src/interactions.ts[L1-L812]
2. Read: [+2s 4720b] src/types.ts[L1-L203]
3. Read: [+1s 2696b] src/custom-tools.ts[L1-L156]

# Suggested: Merge into src/core.ts (1171 lines)
1. Read: [+0s 13572b] src/core.ts[L1-L1171]  # Reduces 3 reads → 1 read
# Saves: ~380 tokens per cycle × 23 times = ~8,740 tokens total
```

> **See [instructions.md](instructions.md) for detailed pattern examples and optimization strategies.**