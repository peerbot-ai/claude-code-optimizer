#!/bin/bash

# Token Optimizer SessionStart Hook
# Analyzes conversation history and appends optimization opportunities to system prompt

# Run the analyzer in hook mode (suppresses errors)
ANALYSIS=$(node "${CLAUDE_PLUGIN_ROOT}/index.js" --format=hook 2>/dev/null)

# Only output if analysis found patterns
if [ -n "$ANALYSIS" ] && [ "$ANALYSIS" != "null" ]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "$ANALYSIS"
  }
}
EOF
fi

exit 0
