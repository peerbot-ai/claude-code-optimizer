Analyze conversation history for token optimization opportunities and generate helpers.

**Plugin Location:** The agent-trace-ops plugin is installed at `${CLAUDE_PLUGIN_ROOT}` which contains `index.js` for running analysis.

@${CLAUDE_PLUGIN_ROOT}/instructions.md

Steps:
1. Check for existing reports by running: `node ${CLAUDE_PLUGIN_ROOT}/index.js --project-path=$(pwd) --list`

2. If report exists:
   - Use AskUserQuestion to ask: "Found report from [timestamp]. What would you like to do?"
   - Options: "Reuse existing report (faster)" | "Generate fresh report (includes latest conversations)"

3. Generate or retrieve report:
   - If "Reuse existing": Read the existing report file from step 1
   - If "Generate fresh" or no report exists:
     - Run: `node ${CLAUDE_PLUGIN_ROOT}/index.js --project-path=$(pwd) --print`
     - This command outputs the report to stdout AND saves to ~/.ato/projects/{project}/report-{timestamp}.md
     - Use the Bash tool output directly (it contains the full report markdown)
     - Note: By default, all conversations are analyzed. Use --recent=N to limit analysis for faster processing.

4. Use AskUserQuestion (multiSelect:true) to ask which optimizations:
   - "Quick Commands"
   - "Parameterized Scripts (reusable bash/python scripts)"
   - "File Refactorings (merge/split frequently accessed files)"

5. Launch Task agents in PARALLEL (single message with 3 Task calls):
   - Task(subagent_type=general-purpose, prompt="Find 5+ Quick Command patterns...")
   - Task(subagent_type=general-purpose, prompt="Find 5+ Script patterns...")
   - Task(subagent_type=general-purpose, prompt="Find 5+ Refactoring patterns...")

6. Each agent:
   - Analyzes report and generates minimum 5 suggestions per category
   - Calculates impact: occurrences × cost_per_use
   - Writes findings to CLAUDE.md in relevant directory

7. Show summary: "Found X patterns, potential savings: $Y.YY"

Important:
- Launch agents in parallel (one message, multiple Task tool calls)
- Report location: ~/.ato/projects/-{project-path-with-slashes-as-dashes}/
- Always ask before regenerating (respect user's choice)
