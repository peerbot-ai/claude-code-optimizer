Analyze conversation history for token optimization opportunities and generate helpers.

**Plugin Location:** The agent-trace-ops plugin is installed at `${CLAUDE_PLUGIN_ROOT}` which contains `index.js` for running analysis.

@${CLAUDE_PLUGIN_ROOT}/instructions.md

Steps:
1. Check for existing reports by running: `node ${CLAUDE_PLUGIN_ROOT}/index.js --project-path=$(pwd) --list`

2. If report exists:
   - Use AskUserQuestion to ask: "Found report from [timestamp]. What would you like to do?"
   - Options: "Reuse existing report" | "Generate fresh report (ask [NUMBER_OF_LAST_CONVERSATIONS] with values 50, 200, all)"

3. Generate or retrieve report:
   - If "Reuse existing": Read the existing report file from step 1
   - If "Generate fresh" or no report exists:
     - Run: `node ${CLAUDE_PLUGIN_ROOT}/index.js --project-path=$(pwd) --print --recent [NUMBER_OF_LAST_CONVERSATIONS]`
     - This command outputs the report to stdout AND saves to ~/.ato/projects/{project}/report-{timestamp}.md
     - Use the Bash tool output directly (it contains the full report markdown)
     - Note: By default, all conversations are analyzed. Use --recent=N to limit analysis for recent conversations.

4. Use AskUserQuestion (multiSelect:true) to ask which optimizations:
   - "Quick Commands"
   - "Parameterized Scripts (reusable bash/python scripts)"
   - "File Refactorings (merge/split frequently accessed files)"

5. Analyze the report directly and generate optimizations for selected categories:
   - Analyze report and generate suggestions per selected category (flexible count based on patterns found)
   - Calculate impact based on occurrences of patterns
   - **For Scripts category: Show --help output for each script to demonstrate its interface**
   - **For Scripts category: Explain reasoning for why each script is useful (problem solved, token savings, use cases)**
   - For each script, include:
     * --help output showing usage, parameters, and options
     * Explanation of why it's useful (what problem it solves)
     * Token savings breakdown (per-use and total savings)
     * When to use it (use cases and scenarios)
   - **For File Refactorings category: Explain reasoning for each refactoring (why useful, token savings, implementation approach, trade-offs)**
   - For each refactoring, include:
     * Current file structure and access patterns
     * Proposed file structure
     * Before/after token usage comparison
     * Implementation approach and considerations
     * Potential trade-offs and recommendations
   - Display all findings directly in your response

6. Show summary: "Found X patterns"
   - **For Scripts: Include --help output and reasoning directly in the response**
   - **For File Refactorings: Include full explanations with reasoning, token savings, and implementation approach**
   - **Display --help outputs and detailed explanations so user can see interfaces and rationale immediately**
   - Organize by category with clear headings

Important:
- Analyze and show results directly - do not delegate to Task agents
- Report location: ~/.ato/projects/-{project-path-with-slashes-as-dashes}/
- Always ask before regenerating (respect user's choice)
