#!/usr/bin/env node

/**
 * Agent Trace Optimizer
 * Analyzes Claude Code conversation history to identify token optimization opportunities
 * Works as: npx package, Claude Code plugin, or programmatic library
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class TokenOptimizer {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.atoDir = path.join(os.homedir(), '.ato', 'projects');
    this.format = options.format || 'cli';
    this.verbose = options.verbose || false;
    this.skipClaudeAnalysis = options.skipClaudeAnalysis || false;
    this.print = options.print || false;
    this.recentLimit = options.recentLimit !== undefined ? options.recentLimit : null; // Default: all conversations
    this.concurrency = options.concurrency || null; // Auto-detect if not set
    this.agent = options.agent || 'claude'; // Default to claude

    // Validate agent option
    const supportedAgents = ['claude'];
    if (!supportedAgents.includes(this.agent)) {
      throw new Error(`Unsupported agent: ${this.agent}. Supported agents: ${supportedAgents.join(', ')}`);
    }
  }

  /**
   * Model pricing (per 1M tokens)
   */
  getModelPricing(model) {
    if (!model) {
      return { input: 3, output: 15, name: 'Claude 3.5 Sonnet (assumed)' };
    }

    // Claude Sonnet 4.5 pricing
    if (model.includes('sonnet-4-5') || model.includes('sonnet-4.5')) {
      return { input: 3, output: 15, name: model };
    }

    // Claude 3.5 Sonnet pricing
    if (model.includes('sonnet-3-5') || model.includes('sonnet-3.5') || model.includes('sonnet')) {
      return { input: 3, output: 15, name: model };
    }

    // Default to Sonnet pricing but keep actual model name
    return { input: 3, output: 15, name: `${model} (assumed Sonnet pricing)` };
  }

  /**
   * Calculate cost based on actual usage
   */
  calculateCost(inputTokens, outputTokens, model) {
    const pricing = this.getModelPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    return {
      total: inputCost + outputCost,
      input: inputCost,
      output: outputCost,
      modelName: pricing.name
    };
  }

  /**
   * Format cost for display
   */
  formatCost(cost) {
    return `$${cost.toFixed(4)}`;
  }

  /**
   * Check if Claude CLI is available
   */
  async checkClaudeCli() {
    try {
      await execAsync('which claude');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get project's .ato directory
   */
  getProjectAtoDir() {
    let projectPath = this.projectPath;
    if (projectPath.startsWith('~/')) {
      projectPath = path.join(os.homedir(), projectPath.slice(2));
    }
    const resolvedPath = path.resolve(projectPath);
    const mappedName = resolvedPath.replace(/\//g, '-');
    return path.join(this.atoDir, mappedName);
  }

  /**
   * Find the most recent report for current project
   */
  findLatestReport() {
    const projectAtoDir = this.getProjectAtoDir();
    if (!fs.existsSync(projectAtoDir)) return null;

    const reports = fs.readdirSync(projectAtoDir)
      .filter(f => f.startsWith('report-') && f.endsWith('.md'))
      .map(f => ({
        path: path.join(projectAtoDir, f),
        time: fs.statSync(path.join(projectAtoDir, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    return reports.length > 0 ? reports[0] : null;
  }

  /**
   * List all reports for current project
   */
  listAllReports() {
    const projectAtoDir = this.getProjectAtoDir();
    if (!fs.existsSync(projectAtoDir)) {
      return [];
    }

    const reports = fs.readdirSync(projectAtoDir)
      .filter(f => f.startsWith('report-') && f.endsWith('.md'))
      .map(f => {
        const filepath = path.join(projectAtoDir, f);
        const stat = fs.statSync(filepath);
        return {
          path: filepath,
          filename: f,
          time: stat.mtime,
          size: stat.size
        };
      })
      .sort((a, b) => b.time - a.time); // Newest first

    return reports;
  }

  /**
   * Format time ago string
   */
  formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 30) return `${diffDay}d ago`;

    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth}mo ago`;

    const diffYear = Math.floor(diffDay / 365);
    return `${diffYear}y ago`;
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Find all project directories
   */
  findProjectDirs() {
    // Expand ~ to home directory if present
    let projectPath = this.projectPath;
    if (projectPath.startsWith('~/')) {
      projectPath = path.join(os.homedir(), projectPath.slice(2));
    }

    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path not found: ${resolvedPath}`);
    }

    // Check if this is already a .claude/projects directory (has .jsonl files)
    const hasConversations = fs.existsSync(resolvedPath) &&
      fs.readdirSync(resolvedPath).some(f => f.endsWith('.jsonl'));

    if (hasConversations) {
      // Already a conversation directory, use as-is
      return [resolvedPath];
    }

    // Otherwise, map project path to .claude/projects directory
    // /Users/name/Code/project -> -Users-name-Code-project
    const mappedName = resolvedPath.replace(/\//g, '-');
    const claudeProjectPath = path.join(this.projectsDir, mappedName);

    if (!fs.existsSync(claudeProjectPath)) {
      throw new Error(`No conversation history found for project: ${resolvedPath}\nExpected: ${claudeProjectPath}`);
    }

    return [claudeProjectPath];
  }

  /**
   * Find conversation JSONL files in a project directory
   */
  findConversationFiles(projectDir) {
    try {
      return fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => path.join(projectDir, file));
    } catch {
      return [];
    }
  }

  /**
   * Parse a JSONL file (one JSON object per line)
   */
  parseJSONL(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(obj => obj !== null);
    } catch {
      return [];
    }
  }

  /**
   * Get the most recent timestamp from a conversation file (for sorting)
   * Uses file modification time for performance (instead of parsing JSONL)
   */
  getFileTimestamp(filePath) {
    try {
      return fs.statSync(filePath).mtime.getTime();
    } catch {
      return 0;
    }
  }

  /**
   * Format duration between timestamps
   */
  formatDuration(start, end) {
    try {
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const diffMs = endMs - startMs;

      if (diffMs < 0 || diffMs > 3600000) return null; // Ignore negative or > 1 hour
      if (diffMs < 1000) return null; // Skip sub-second durations
      if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;

      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.round((diffMs % 60000) / 1000);
      return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
    } catch {
      return null;
    }
  }

  /**
   * Format session duration
   */
  formatSessionDuration(diffMs) {
    if (diffMs < 1000) return '<1s';
    if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;

    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes < 60) {
      const seconds = Math.round((diffMs % 60000) / 1000);
      return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  /**
   * Format session start time
   */
  formatSessionStartTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Generate analysis report for Claude to analyze with rich metadata
   */
  generateAnalysisReport(sequences) {
    let report = '# Conversation History Analysis\n\n';

    // Calculate total tool calls from timeline strings
    const totalToolCalls = sequences.reduce((sum, s) => {
      return sum + (s.timeline.split('\n').length || 0);
    }, 0);

    // Extract actual usage data from conversation entries
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const models = new Set();

    sequences.forEach(seq => {
      if (seq.entries) {
        seq.entries.forEach(entry => {
          if (entry.type === 'assistant' && entry.message && entry.message.usage) {
            const usage = entry.message.usage;
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;

            if (entry.message.model && entry.message.model !== '<synthetic>') {
              models.add(entry.message.model);
            }
          }
        });
      }
    });

    // Get most common model or default
    const modelName = models.size > 0 ? Array.from(models)[0] : null;
    const costData = this.calculateCost(totalInputTokens, totalOutputTokens, modelName);

    report += `## Summary\n`;
    report += `- Total Conversations: ${sequences.length}\n`;
    report += `- Total Tool Calls: ${totalToolCalls}\n`;
    report += `- Model: ${costData.modelName}\n`;
    report += `- Input Tokens: ${totalInputTokens}\n`;
    report += `- Output Tokens: ${totalOutputTokens}\n`;
    report += `- Total Cost: ${this.formatCost(costData.total)} (in: ${this.formatCost(costData.input)}, out: ${this.formatCost(costData.output)})\n\n`;

    // Extract tool usage from timelines
    const toolCounts = {};
    sequences.forEach(seq => {
      const lines = seq.timeline.split('\n');
      lines.forEach(line => {
        const match = line.match(/^\d+\.\s+(\w+):/);
        if (match) {
          const tool = match[1];
          toolCounts[tool] = (toolCounts[tool] || 0) + 1;
        }
      });
    });

    report += `## Tool Usage Distribution\n`;
    Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([tool, count]) => {
        report += `- ${tool}: ${count} calls\n`;
      });
    report += '\n';

    // Add instructions for extracting heredoc commands
    report += `## Extracting Heredoc Commands\n\n`;
    report += `Some bash commands use heredocs and are shown as references when they're too long. To extract the full command:\n\n`;
    report += '```bash\n';
    report += `# Find the conversation file (usually in ~/.claude/projects/.../*.jsonl)\n`;
    report += `jq '.entries[] | select(.message.content[]?.tool_use_id == "TOOL_ID") | .message.content[] | select(.type == "tool_use") | .input.command' CONVERSATION_FILE.jsonl\n`;
    report += '```\n\n';
    report += `Replace \`TOOL_ID\` with the ID shown in the heredoc reference.\n\n`;

    // Sort conversations by timestamp (newest first)
    const conversationsWithTimestamps = sequences.map((seq, index) => {
      const timestamps = (seq.entries || [])
        .map(e => e.timestamp ? new Date(e.timestamp).getTime() : null)
        .filter(t => t !== null);
      const startTime = timestamps.length > 0 ? Math.min(...timestamps) : 0;
      return { seq, index, startTime };
    });

    conversationsWithTimestamps.sort((a, b) => b.startTime - a.startTime);

    // Sessions with rich timelines
    report += `## Sessions\n\n`;

    for (const { seq, index } of conversationsWithTimestamps) {
      const filename = seq.file || `session-${index}`;
      const sessionId = path.basename(filename, '.jsonl');

      // Calculate session metadata
      const timestamps = (seq.entries || [])
        .map(e => e.timestamp ? new Date(e.timestamp).getTime() : null)
        .filter(t => t !== null);

      let startTimeStr = '';
      let durationStr = '';

      if (timestamps.length > 0) {
        const start = Math.min(...timestamps);
        const end = Math.max(...timestamps);
        const startDate = new Date(start);
        startTimeStr = ` [${this.formatSessionStartTime(startDate)}]`;

        if (timestamps.length > 1) {
          durationStr = ` (${this.formatSessionDuration(end - start)})`;
        }
      }

      // Build session section
      let sessionSection = `### Session ${sessionId}${startTimeStr}${durationStr}\n`;
      sessionSection += `${seq.timeline}\n\n`;
      report += sessionSection;
    }

    return report;
  }

  /**
   * Call Claude CLI to analyze patterns with user confirmation
   */
  async analyzeWithClaude(report, reportFile) {
    // Get report stats
    const reportLines = report.split('\n');
    const totalLines = reportLines.length;
    const previewLines = reportLines.slice(0, 200);
    const hasMore = totalLines > 200;

    // Read shared instructions
    const instructionsPath = path.join(__dirname, 'instructions.md');
    let sharedInstructions = '';
    try {
      sharedInstructions = fs.readFileSync(instructionsPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read instructions.md: ${error.message}\nExpected at: ${instructionsPath}`);
    }

    // Create prompt without preview to save tokens
    const prompt = `Report saved at: ${reportFile}
Total lines: ${totalLines}

**Task:**
1. Read the full report from ${reportFile}. If the file is large, you might need to read it in chunks.
2. Use AskUserQuestion to ask which categories to optimize:
   - Quick Commands: One-liner chains for package.json/Makefile/pyproject.toml
   - Scripts: Reusable parameterized scripts for common workflows
   - File Refactorings: Merge frequently co-accessed files, split large files
3. Launch parallel Task subagents for selected categories

${sharedInstructions}`;

    // Calculate approximate sizes (bytes / 4 ≈ tokens)
    const reportBytes = report.length;
    const reportTokensApprox = Math.ceil(reportBytes / 4);

    // Show file info and prompt preview
    console.log('\n' + '='.repeat(70));
    console.log('📊 ANALYSIS READY');
    console.log('='.repeat(70));
    console.log(`\n📄 Report file: ${reportFile}`);
    console.log(`📏 Report size: ${totalLines} lines (~${reportTokensApprox.toLocaleString()} tokens)`);

    // Show report preview for user visibility
    console.log('\n' + '─'.repeat(70));
    console.log('📋 Report Preview (first 50 lines for your reference):');
    console.log('─'.repeat(70));
    const reportPreviewForUser = previewLines.slice(0, 50).join('\n');
    console.log(reportPreviewForUser);
    if (hasMore) {
      console.log(`\n... (${totalLines - 200} more lines in the full report)`);
    }
    console.log('─'.repeat(70));

    // Show concise prompt that will be sent
    console.log('\n📝 Prompt to Claude (summarized):');
    console.log('─'.repeat(70));
    const promptSummary = prompt.split('\n').slice(0, 20).join('\n');
    console.log(promptSummary);
    console.log('... [instructions for 3 optimization categories]');
    console.log('─'.repeat(70));

    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question('\n🚀 Launch Claude Code with this prompt? [y/N]: ', async (answer) => {
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('\n❌ Cancelled by user');
          console.log(`📄 Report saved at: ${reportFile}`);
          resolve(null);
          return;
        }

        try {
          await this.launchClaudeWithPrompt(prompt, reportFile);
          resolve(null);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Launch Claude with prompt as argument
   */
  async launchClaudeWithPrompt(prompt, reportFile = null) {
    // Check if Claude Code is initialized in project directory
    const claudeDir = path.join(this.projectPath, '.claude');
    if (!fs.existsSync(claudeDir)) {
      throw new Error(
        `Claude Code not initialized in ${this.projectPath}\n` +
        `Please run: cd ${this.projectPath} && claude init`
      );
    }

    try {
      // Show command that will be run
      console.log('\n' + '─'.repeat(70));
      if (reportFile) {
        console.log('📄 Analysis file: ' + reportFile);
      }
      console.log('📂 Working directory: ' + this.projectPath);
      console.log('─'.repeat(70));

      console.log('\n🚀 Launching Claude Code...\n');

      const { spawn } = require('child_process');

      return new Promise((resolve, reject) => {
        // Launch Claude with prompt as argument (avoids TTY error from piping)
        const claude = spawn('claude', [prompt], {
          cwd: this.projectPath,
          stdio: 'inherit'
        });

        claude.on('close', (code) => {
          // Report file is kept in ~/.ato/projects/
          if (reportFile) {
            console.log(`\n📄 Report saved at: ${reportFile}`);
          }

          if (code === 0) {
            resolve(null);
          } else {
            reject(new Error(`Claude exited with code ${code}`));
          }
        });

        claude.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Format output based on mode
   */
  formatOutput(recommendations) {
    if (this.format === 'hook') {
      return this.formatHookOutput(recommendations);
    } else {
      // For CLI, just output the recommendations as JSON
      return JSON.stringify(recommendations, null, 2);
    }
  }

  /**
   * Format for hook (appended to system prompt)
   */
  formatHookOutput(recommendations) {
    if (!recommendations || recommendations.length === 0) {
      return null;
    }

    const top3 = recommendations.slice(0, 3);
    const totalSavings = recommendations.reduce((sum, r) =>
      sum + (r.current_tokens - r.optimized_tokens) * r.frequency, 0
    );

    let output = 'Token Optimization Detected:\\n\\n';
    top3.forEach(r => {
      const savings = (r.current_tokens - r.optimized_tokens) * r.frequency;
      output += `• ${r.pattern_name}: ${r.frequency} occurrences (${savings} tokens saved)\\n`;
    });

    output += `\\nTotal potential savings: ${totalSavings} tokens\\n\\n`;
    output += 'Ask me to generate helpers with: "Generate token optimization helpers"';

    return output;
  }

  /**
   * Main run method
   */
  async run() {
    try {
      // Check Claude CLI (skip if testing)
      if (!this.skipClaudeAnalysis) {
        const hasClaudeCli = await this.checkClaudeCli();
        if (!hasClaudeCli) {
          throw new Error(
            'Claude CLI not found. Please install Claude Code from https://claude.ai/claude-code'
          );
        }
      }

      // Find and parse conversations
      const projectDirs = this.findProjectDirs();
      if (projectDirs.length === 0) {
        throw new Error(`No conversation history found at ${this.projectsDir}`);
      }

      // Collect all conversation files from all project directories
      const allFiles = [];
      for (const dir of projectDirs) {
        const files = this.findConversationFiles(dir);
        allFiles.push(...files);
      }

      // Sort files by timestamp (newest first)
      const filesWithTimestamps = allFiles.map(file => ({
        path: file,
        timestamp: this.getFileTimestamp(file)
      }));
      filesWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

      // Take only the N most recent files (or all if recentLimit is null)
      const filesToProcess = this.recentLimit !== null
        ? filesWithTimestamps.slice(0, this.recentLimit).map(f => f.path)
        : filesWithTimestamps.map(f => f.path);

      if (this.format === 'cli' && !this.print) {
        console.log(`\n📂 Found ${allFiles.length} conversation file(s)`);
        if (this.recentLimit !== null && filesToProcess.length < allFiles.length) {
          console.log(`📅 Analyzing ${filesToProcess.length} most recent (use --recent=${allFiles.length} to analyze all)\n`);
        } else {
          console.log(`📅 Analyzing all ${filesToProcess.length} conversation(s)\n`);
        }
      }

      // Parse and analyze in batches
      const PARSE_BATCH = 50; // Parse 50 files at a time (I/O bound)

      // CPU-bound analysis: Use cpus - 1 to leave room for main thread
      // Cap at 16 workers for better performance on high-core machines
      const cpuCount = os.cpus().length;
      const ANALYZE_BATCH = this.concurrency || Math.min(16, Math.max(2, cpuCount - 1));

      const allConversations = [];
      const allSequences = [];
      let processedFiles = 0;
      const startTime = Date.now();

      if (this.format === 'cli' && !this.print) {
        console.log(`⚙️  Processing in batches`);
      }

      for (let i = 0; i < filesToProcess.length; i += PARSE_BATCH) {
        // Parse batch
        const parseBatch = filesToProcess.slice(i, i + PARSE_BATCH);
        const parsedConversations = await Promise.all(
          parseBatch.map(async (file) => {
            const entries = this.parseJSONL(file);
            return entries.length > 0 ? { filePath: file, entries } : null;
          })
        );
        const validConversations = parsedConversations.filter(c => c !== null);

        if (validConversations.length === 0) continue;

        // Analyze batch with workers
        const { Worker } = require('worker_threads');
        const batchSequences = [];

        for (let j = 0; j < validConversations.length; j += ANALYZE_BATCH) {
          const analyzeBatch = validConversations.slice(j, j + ANALYZE_BATCH);
          const workerPromises = analyzeBatch.map((conv) => {
            return new Promise((resolve, reject) => {
              const worker = new Worker(path.join(__dirname, 'conversation-worker.js'), {
                workerData: { conversation: conv }
              });

              worker.on('message', (msg) => {
                if (msg.success) {
                  resolve(msg.result);
                } else {
                  reject(new Error(msg.error));
                }
                worker.terminate();
              });

              worker.on('error', reject);
              worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker exit ${code}`));
              });
            });
          });

          const results = await Promise.all(workerPromises);
          batchSequences.push(...results.filter(r => r !== null));
        }

        processedFiles += parseBatch.length;

        if (this.format === 'cli') {
          const percent = Math.round((processedFiles / filesToProcess.length) * 100);
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const rate = processedFiles / elapsed;
          const remaining = filesToProcess.length - processedFiles;
          const eta = remaining > 0 ? Math.round(remaining / rate) : 0;

          // Show progress (use stderr so it doesn't interfere with --print output)
          process.stderr.write(`\r   📊 Progress: ${processedFiles}/${filesToProcess.length} files (${percent}%) | ⏱️  ${elapsed}s elapsed, ~${eta}s remaining`);
        }

        allConversations.push(...validConversations);
        allSequences.push(...batchSequences);
      }

      if (allConversations.length === 0) {
        throw new Error('No valid conversation data found');
      }

      if (this.format === 'cli') {
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        process.stderr.write(`\r` + ' '.repeat(120) + `\r`); // Clear progress line
        if (!this.print) {
          console.log(`✓ Analysis complete (${allSequences.length} conversations in ${totalTime}s)\n`);
        }
      }

      const sequences = allSequences;

      // Generate analysis report
      const report = this.generateAnalysisReport(sequences);

      // Save report to ~/.ato/projects/ following same structure as .claude
      const projectAtoDir = this.getProjectAtoDir();

      if (!fs.existsSync(projectAtoDir)) {
        fs.mkdirSync(projectAtoDir, { recursive: true });
      }

      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/T/, '-')
        .replace(/:/g, '-')
        .replace(/\..+/, ''); // YYYY-MM-DD-HH-MM-SS
      const reportFile = path.join(projectAtoDir, `report-${timestamp}.md`);
      fs.writeFileSync(reportFile, report);

      // Print mode: just output the report without calling Claude
      if (this.print) {
        if (this.format === 'cli') {
          console.log(`📄 Report saved at: ${reportFile}\n`);
        }
        return report;
      }

      // Analyze with Claude (skip if testing)
      if (!this.skipClaudeAnalysis) {
        await this.analyzeWithClaude(report, reportFile);
        return null; // Claude output already went to stdout
      }

      // Testing mode (skipClaudeAnalysis)
      return report;
    } catch (error) {
      if (this.format === 'hook') {
        return null; // Silent fail for hooks
      } else {
        throw error;
      }
    }
  }
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Agent Trace Optimizer - Analyze Claude Code conversation history

Usage:
  agent-trace-ops [options]

Options:
  --help, -h                  Show this help message
  --list, -l                  List all available reports for current project
  --print, -p                 Output the analysis prompt without calling Claude
  --project-path=<path>       Path to project directory to analyze (defaults to current directory)
  --format=<type>             Output format: 'cli' (default) or 'hook'
  --recent=<number>           Number of recent conversations to analyze (default: all)
  --concurrency=<number>      Number of worker threads for parallel analysis (default: auto)
  --agent=<name>              AI agent to use for analysis (default: claude, available: claude)
  --verbose, -v               Enable verbose logging

Examples:
  # Analyze current directory (all conversations)
  agent-trace-ops or ato

  # List all available reports for current project
  ato --list

  # Analyze a specific project directory
  ato --project-path=~/.claude/projects/my-project

  # Analyze with specific agent (currently only claude is supported)
  ato --agent=claude

  # Analyze only last 50 conversations (faster for large projects)
  ato --recent=50

  # Analyze last 200 conversations
  ato --recent=200

  # See the analysis prompt without calling Claude
  ato --print

  # Analyze specific project and print prompt
  ato --project-path=~/my-project --print

  # Set concurrency for faster processing (on high-core machines)
  ato --concurrency=8

  # Hook format (for plugin integration)
  ato --format=hook

Plugin Installation:
  /plugin marketplace add peerbot-ai/agent-trace-ops
  /plugin install agent-trace-ops

NPM Installation:
  npx agent-trace-ops
  npm install -g agent-trace-ops

For more info: https://github.com/peerbot-ai/agent-trace-ops
`);
    process.exit(0);
  }

  // Parse options (support both --flag=value and --flag value formats)
  const getOption = (flag) => {
    // Try --flag=value format
    const withEquals = args.find(arg => arg.startsWith(`${flag}=`));
    if (withEquals) return withEquals.split('=')[1];

    // Try --flag value format
    const flagIndex = args.indexOf(flag);
    if (flagIndex !== -1 && flagIndex + 1 < args.length) {
      return args[flagIndex + 1];
    }

    return null;
  };

  const format = getOption('--format') || 'cli';
  const verbose = args.includes('--verbose') || args.includes('-v');
  const print = args.includes('--print') || args.includes('-p');
  const list = args.includes('--list') || args.includes('-l');
  const projectPath = getOption('--project-path');
  const recentStr = getOption('--recent');
  const recentLimit = recentStr ? parseInt(recentStr, 10) : undefined;
  const concurrencyStr = getOption('--concurrency');
  const concurrency = concurrencyStr ? parseInt(concurrencyStr, 10) : undefined;
  const agent = getOption('--agent');

  const optimizer = new TokenOptimizer({ format, verbose, print, projectPath, recentLimit, concurrency, agent });

  // Handle --list flag
  if (list) {
    const reports = optimizer.listAllReports();

    if (reports.length === 0) {
      console.log('No reports found for this project.');
      console.log(`\nExpected location: ${optimizer.getProjectAtoDir()}`);
      console.log('\nRun without --list to generate a new report.');
      process.exit(0);
    }

    console.log(`\nAvailable reports for: ${optimizer.projectPath}`);
    console.log(`Location: ${optimizer.getProjectAtoDir()}\n`);
    console.log('─'.repeat(80));

    reports.forEach((report, index) => {
      const timestamp = report.filename.replace('report-', '').replace('.md', '');
      const timeAgo = optimizer.formatTimeAgo(report.time);
      const size = optimizer.formatBytes(report.size);

      console.log(`${index + 1}. ${timestamp}`);
      console.log(`   Created: ${timeAgo} | Size: ${size}`);
      console.log(`   Path: ${report.path}`);
      console.log('');
    });

    console.log('─'.repeat(80));
    console.log(`Total: ${reports.length} report(s)\n`);
    process.exit(0);
  }

  optimizer.run()
    .then(output => {
      if (output) {
        console.log(output);
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

// Export for programmatic use
module.exports = TokenOptimizer;
