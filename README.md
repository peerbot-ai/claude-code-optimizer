# Agent Token Optimizer

Analyzes your Claude Code conversation history, enriches tool call metadata, compresses conversation data with RLE, and uses Claude Code to detect repetitive multi-step patterns. It suggests:
1. Helper scripts that trigger multiple tool calls in a single Bash command to save tokens on repeated workflows.
2. File refactorings that merges/splits files to save tokens on repeated workflows.

## Usage

### Claude Code Plugin

```bash
/plugin marketplace add peerbot-ai/agent-trace-ops
/plugin install agent-trace-ops
```

After installing the plugin, use the `/optimize-tokens` command for on-demand analysis:

```bash
/optimize-tokens
```

This will:
1. Check for existing analysis reports
2. Ask if you want to reuse or regenerate the report
3. Let you select which optimization categories to analyze:
   - Quick Commands (one-liner chains for package.json/Makefile)
   - Parameterized Scripts (reusable workflows)
   - File Refactorings (merge/split frequently accessed files)
4. Launch parallel Task agents to analyze patterns
5. Generate helpers and show potential token savings

### CLI

Run a standalone analysis without installing:

```bash
npx agent-trace-ops
```
Install globally for repeated use:

```bash
npm install -g agent-trace-ops
ato --project-path=<path> --agent=claude
```

## How it works

Claude Code stores conversation history in `~/.claude/projects/<hash>/*.jsonl` files. The tool parses these files, extracts tool call patterns and sends them to Claude AI for analysis.
Claude AI then suggests helper scripts and file refactorings that can save tokens on repeated workflows.

### Example Optimizations

**Quick Commands** - Combine repeated bash sequences:
```bash
# Before: 4 separate Bash calls each time you test ($0.0055 per iteration)
npm run build
npm run test
npm run lint
npm run format:check

# After: 1 command in package.json scripts
npm run precommit  # → $1.40 (75% savings, 200 iterations per year)
# package.json: "precommit": "npm run build && npm test && npm run lint && npm run format:check"
```

**Parameterized Scripts** - Reusable workflows:
```bash
# Before: 4 Bash calls every time you debug a service ($0.0060 per service)
docker ps | grep auth-service
docker logs auth-service --tail=100
docker exec auth-service cat /app/config.json
docker stats auth-service --no-stream

# After: 1 script call with parameters
./scripts/debug-service.sh auth-service 100  # → $0.0015 (75% savings, 300 iterations per year)
# Reusable for any service: api-gateway, payment-processor, etc.
```

**File Refactorings** - Merge co-accessed files:
```bash
# Before: Reading 3 files per change ($0.0345)
Read: src/types.ts (203 lines)
Read: src/utils.ts (156 lines)
Read: src/config.ts (89 lines)

# After: Merged into src/core.ts (448 lines)
Read: src/core.ts (448 lines)  # → $0.0115 (67% savings, 200 iterations per year)
```

> **See [instructions.md](instructions.md) for detailed pattern examples and optimization strategies.**

## Development

```bash
# Clone the repository
git clone https://github.com/peerbot-ai/agent-trace-ops.git
cd agent-trace-ops

# Run locally
node index.js

# Test hook mode
node index.js --format=hook
```

## Publishing

### To npm

```bash
npm publish
```