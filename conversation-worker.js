/**
 * Worker thread for processing conversations in parallel
 * This allows CPU-intensive token counting to happen concurrently
 */

const { parentPort, workerData } = require('worker_threads');

/**
 * Get byte size of text
 */
function getByteSize(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return str.length;
}

/**
 * Format duration between timestamps
 */
function formatDuration(start, end) {
  try {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const diffMs = endMs - startMs;

    if (diffMs < 0 || diffMs > 3600000) return null;
    if (diffMs < 1000) return null;
    if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;

    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.round((diffMs % 60000) / 1000);
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
  } catch {
    return null;
  }
}


/**
 * Model pricing (per 1M tokens)
 * Note: Pricing should be verified against current Anthropic pricing
 * https://www.anthropic.com/pricing
 */
function getModelPricing(model) {
  if (!model || model === 'unknown') {
    return { input: 3, output: 15 };
  }

  const modelLower = model.toLowerCase();

  // Claude Sonnet 4.5 pricing
  if (modelLower.includes('sonnet-4-5') || modelLower.includes('sonnet-4.5') || modelLower.includes('sonnet-4')) {
    return { input: 3, output: 15 };
  }

  // Claude 3.5 Sonnet pricing
  if (modelLower.includes('sonnet-3-5') || modelLower.includes('sonnet-3.5') || modelLower.includes('sonnet-3')) {
    return { input: 3, output: 15 };
  }

  // Claude 3 Opus pricing (higher tier)
  if (modelLower.includes('opus')) {
    return { input: 15, output: 75 };
  }

  // Claude 3 Haiku pricing (lower tier)
  if (modelLower.includes('haiku')) {
    return { input: 0.25, output: 1.25 };
  }

  // Default to Sonnet pricing
  return { input: 3, output: 15 };
}

/**
 * Calculate cost based on actual usage
 */
function calculateCost(inputTokens, outputTokens, model) {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Truncate user message to max length
 */
function truncateUserMessage(text, maxLength = 100) {
  if (!text) return '';
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  // Replace newlines with spaces for single-line display
  const singleLine = str.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return singleLine.substring(0, maxLength - 3) + '...';
}

/**
 * Extract user message text from entry
 */
function extractUserMessage(entry) {
  if (entry.type !== 'user' || !entry.message?.content) return null;

  // Find text content blocks
  for (const block of entry.message.content) {
    if (block.type === 'text' && block.text) {
      return truncateUserMessage(block.text);
    }
  }

  return null;
}

/**
 * Format tool calls
 */
function formatReadTool(tool, result) {
  const filepath = tool.input?.file_path || 'unknown';
  const filename = filepath.includes('/') ? filepath.split('/').pop() : filepath;

  const content = result?.content || '';
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const bytes = getByteSize(contentStr);
  const lines = typeof content === 'string' ? content.split('\n').length : 1;

  const offset = tool.input?.offset || 0;
  const limit = tool.input?.limit;
  const startLine = offset + 1;
  const endLine = limit ? offset + limit : offset + lines;
  const lineRange = `L${startLine}-L${endLine}`;

  return { filename, bytes, lineRange };
}

function formatWriteTool(tool) {
  const filepath = tool.input?.file_path || 'unknown';
  const filename = filepath.includes('/') ? filepath.split('/').pop() : filepath;
  const content = tool.input?.content || '';
  const bytes = getByteSize(content);
  const lines = content.split('\n').length;
  const lineRange = `L1-L${lines}`;
  return { filename, bytes, lineRange };
}

function formatEditTool(tool) {
  const filepath = tool.input?.file_path || 'unknown';
  const filename = filepath.includes('/') ? filepath.split('/').pop() : filepath;
  const content = tool.input?.new_string || '';
  const bytes = getByteSize(content);
  const lines = content.split('\n').length;
  const lineRange = `L1-L${lines}`;
  return { filename, bytes, lineRange };
}

function formatBashTool(tool, result, timeMetadata) {
  const cmd = tool.input?.command || '';
  const exitCode = result?.exit_code !== undefined ? result.exit_code : 0;

  const parts = [];
  // Add exit code if non-zero (indicates failure)
  if (exitCode !== 0) parts.push(`exit=${exitCode}`);
  if (cmd) parts.push(`cmd=${getByteSize(cmd)}b`);
  if (result?.content) {
    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    if (content.length > 0) parts.push(`out=${getByteSize(content)}b`);
  }

  const resultMeta = parts.length > 0 ? parts.join(' ') : '';
  const fullMeta = timeMetadata + resultMeta;

  // Detect heredoc pattern (e.g., << 'EOF', << EOF, << "END", <<EOF)
  const heredocPattern = /<<\s*['"]?\w+['"]?/;
  const hasHeredoc = heredocPattern.test(cmd);

  if (hasHeredoc) {
    // Replace with reference to tool_use_id
    const reference = `<heredoc - see tool_use_id="${tool.id}">`;
    return fullMeta ? `Bash: [${fullMeta.trim()}] ${reference}` : `Bash: ${reference}`;
  }

  // Show full command for non-heredoc commands
  return fullMeta ? `Bash: [${fullMeta.trim()}] ${cmd}` : `Bash: ${cmd}`;
}

function formatTaskTool(tool, timeMetadata) {
  const subagent = tool.input?.subagent_type || 'unknown';
  const desc = tool.input?.description || '';
  return timeMetadata
    ? `Task: [${timeMetadata.trim()}] ${subagent}${desc ? ` ("${desc}")` : ''}`
    : `Task: ${subagent}${desc ? ` ("${desc}")` : ''}`;
}

function formatMcpTool(tool, result, timeMetadata) {
  const mcpName = tool.name.replace(/^mcp__/, '').replace(/__/g, '.');

  const inputBytes = getByteSize(JSON.stringify(tool.input || {}));
  let outputBytes = 0;
  if (result?.content) {
    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    outputBytes = getByteSize(content);
  }

  const parts = [];
  if (inputBytes > 0) parts.push(`in=${inputBytes}b`);
  if (outputBytes > 0) parts.push(`out=${outputBytes}b`);

  const resultMeta = parts.length > 0 ? parts.join(' ') : '';
  const fullMeta = timeMetadata + resultMeta;

  // Format parameters - show full values, no truncation
  const params = Object.entries(tool.input || {})
    .map(([k, v]) => {
      if (typeof v === 'string') {
        return `${k}=${v}`;
      }
      return `${k}=${JSON.stringify(v)}`;
    })
    .join(', ');

  return fullMeta ? `MCP: [${fullMeta.trim()}] ${mcpName}(${params})` : `MCP: ${mcpName}(${params})`;
}

/**
 * Format AskUserQuestion tool call
 */
function formatAskUserQuestion(tool, result, timeMetadata) {
  const questions = tool.input?.questions || [];
  const firstQuestion = questions[0]?.question || 'User question';
  const shortQ = firstQuestion.length > 60 ? firstQuestion.substring(0, 57) + '...' : firstQuestion;

  const parts = [];
  if (timeMetadata) parts.push(timeMetadata.trim());

  const metaStr = parts.length > 0 ? `[${parts.join(' ')}] ` : '';
  return `${metaStr}Asked: "${shortQ}"`;
}

/**
 * Format WebFetch tool call
 */
function formatWebFetch(tool, result, timeMetadata) {
  const url = tool.input?.url || 'unknown';
  const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;

  const inputBytes = getByteSize(tool.input?.prompt || '');
  const outputBytes = getByteSize(result?.content || '');

  const parts = [];
  if (timeMetadata) parts.push(timeMetadata.trim());
  if (inputBytes > 0) parts.push(`in=${inputBytes}b`);
  if (outputBytes > 0) parts.push(`out=${outputBytes}b`);

  const metaStr = parts.length > 0 ? `[${parts.join(' ')}] ` : '';
  return `${metaStr}WebFetch: ${shortUrl}`;
}

/**
 * Format WebSearch tool call
 */
function formatWebSearch(tool, result, timeMetadata) {
  const query = tool.input?.query || 'unknown';
  const shortQuery = query.length > 50 ? query.substring(0, 47) + '...' : query;

  const outputBytes = getByteSize(result?.content || '');

  const parts = [];
  if (timeMetadata) parts.push(timeMetadata.trim());
  if (outputBytes > 0) parts.push(`out=${outputBytes}b`);

  const metaStr = parts.length > 0 ? `[${parts.join(' ')}] ` : '';
  return `${metaStr}WebSearch: "${shortQuery}"`;
}

/**
 * Default formatter for unknown tools
 */
function formatUnknownTool(tool, result, timeMetadata) {
  const toolName = tool.name.startsWith('mcp__')
    ? tool.name.substring(5)
    : tool.name;

  const inputBytes = getByteSize(JSON.stringify(tool.input || {}));
  const outputBytes = getByteSize(result?.content || '');

  const parts = [];
  if (timeMetadata) parts.push(timeMetadata.trim());
  if (inputBytes > 0) parts.push(`in=${inputBytes}b`);
  if (outputBytes > 0) parts.push(`out=${outputBytes}b`);

  const metaStr = parts.length > 0 ? `[${parts.join(' ')}] ` : '';
  return `${metaStr}${toolName}: (new tool - needs formatter)`;
}


/**
 * Process a single conversation
 */
function processConversation(conv) {
  const RLE_TOOLS = ['Read', 'Write', 'Edit', 'Think'];

  // Blocklist approach: hide only known low-value tools
  const BLOCKLIST_TOOLS = [
    'Glob', 'Grep',                          // Search operations (internal navigation)
    'TodoWrite',                              // Task management (internal scaffolding)
    'ExitPlanMode', 'Skill', 'SlashCommand', // Meta-tools (mode switching)
    'BashOutput', 'KillShell',               // Internal monitoring/cleanup
    'NotebookEdit'                            // Handled by other formatters
  ];

  const READ_SIZE_THRESHOLD = 3000; // Only show reads >3000 bytes (~1000 tokens)

  if (!conv.entries || conv.entries.length === 0) return null;

  // Build map of tool results
  const toolResults = new Map();
  for (const entry of conv.entries) {
    if (entry.type === 'user' && entry.message?.content) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_result') {
          toolResults.set(block.tool_use_id, block);
        }
      }
    }
  }

  const actions = [];
  let prevTimestamp;
  let lineNum = 1;
  let messageNum = 0;
  let pendingAction = null;
  let lastUserMessage = null;

  const flushPending = () => {
    if (!pendingAction) return;

    let timeMeta = '';
    if (pendingAction.startTime && prevTimestamp) {
      const duration = formatDuration(prevTimestamp, pendingAction.startTime);
      if (duration) timeMeta = `+${duration} `;
    }

    if (pendingAction.type === 'Think') {
      // Format thinking blocks: show count and aggregated tokens
      const count = pendingAction.count || 1;
      const countStr = count > 1 ? `${count}x ` : '';
      const meta = `${timeMeta}${countStr}in=${pendingAction.totalIn}t out=${pendingAction.totalOut}t $${pendingAction.cost.toFixed(4)}`.trim();
      actions.push(`💭 [${meta}]`);
    } else {
      // Format file operations
      const fileEntries = [];
      for (const [file, stats] of pendingAction.files.entries()) {
        for (const range of stats.ranges) {
          fileEntries.push(`${file}[${range}]`);
        }
      }
      const fileList = fileEntries.join(', ');
      const meta = `${timeMeta}${pendingAction.totalBytes}b $${pendingAction.cost.toFixed(4)}`.trim();
      const action = `${pendingAction.type}: [${meta}] ${fileList}`;
      actions.push(`${lineNum}. ${action}`);
      lineNum++;
    }

    prevTimestamp = pendingAction.endTime || pendingAction.startTime;
    pendingAction = null;
  };

  for (const entry of conv.entries || []) {
    // Track user messages
    if (entry.type === 'user') {
      const userMsg = extractUserMessage(entry);
      if (userMsg) {
        lastUserMessage = userMsg;
      }
      continue;
    }

    // Track thinking blocks using RLE accumulation
    if (entry.type === 'assistant' && entry.message?.content?.[0]?.type === 'thinking') {
      const usage = entry.message.usage;
      const model = entry.message.model;

      if (usage && usage.input_tokens && usage.output_tokens) {
        // Filter out unrealistic thinking durations (>60s = idle time)
        const duration = prevTimestamp && entry.timestamp
          ? new Date(entry.timestamp).getTime() - new Date(prevTimestamp).getTime()
          : 0;

        if (duration > 60000) {
          // Skip thinking blocks with >60s gap (user went idle)
          continue;
        }

        const thinkCost = calculateCost(usage.input_tokens, usage.output_tokens, model);

        if (pendingAction?.type === 'Think') {
          // Accumulate consecutive thinking blocks
          pendingAction.count += 1;
          pendingAction.totalIn += usage.input_tokens;
          pendingAction.totalOut += usage.output_tokens;
          pendingAction.cost += thinkCost;
          pendingAction.endTime = entry.timestamp;
        } else {
          // Start new thinking RLE
          flushPending();
          pendingAction = {
            type: 'Think',
            count: 1,
            totalIn: usage.input_tokens,
            totalOut: usage.output_tokens,
            cost: thinkCost,
            startTime: entry.timestamp,
            endTime: entry.timestamp
          };
        }
      }
      continue;
    }

    if (entry.type === 'assistant' && entry.message?.content) {
      const usage = entry.message.usage;
      const model = entry.message.model;
      let entryCost = 0;

      if (usage && usage.input_tokens && usage.output_tokens) {
        entryCost = calculateCost(usage.input_tokens, usage.output_tokens, model);
      }

      messageNum++;

      // Insert user message before this assistant's tool calls
      if (lastUserMessage) {
        actions.push(`\nUser: ${lastUserMessage}\n`);
        lastUserMessage = null; // Clear after use
      }

      // Count tool_use blocks to determine if we should inline tokens
      const toolBlocks = entry.message.content.filter(b => b.type === 'tool_use');
      const shouldInlineTokens = toolBlocks.length === 1;

      for (const block of entry.message.content) {
        if (block.type !== 'tool_use') continue;

        const tool = block;
        const result = toolResults.get(tool.id);

        const isMcpTool = tool.name.startsWith('mcp__');
        const isBlocklisted = BLOCKLIST_TOOLS.includes(tool.name);

        // Skip only if blocklisted (MCP tools never blocked)
        if (isBlocklisted && !isMcpTool) continue;

        let metadata = '';
        if (prevTimestamp && entry.timestamp) {
          const duration = formatDuration(prevTimestamp, entry.timestamp);
          if (duration) metadata += `+${duration} `;
        }

        // Inline token info for single-tool messages
        if (shouldInlineTokens && usage && usage.input_tokens && usage.output_tokens) {
          metadata += `in=${usage.input_tokens}t out=${usage.output_tokens}t $${entryCost.toFixed(4)} `;
        }

        if (RLE_TOOLS.includes(tool.name)) {
          let formatted;
          if (tool.name === 'Read') formatted = formatReadTool(tool, result);
          else if (tool.name === 'Write') formatted = formatWriteTool(tool);
          else if (tool.name === 'Edit') formatted = formatEditTool(tool);

          const { filename, bytes, lineRange } = formatted;

          // Size-based filtering for Read operations
          if (tool.name === 'Read' && bytes < READ_SIZE_THRESHOLD) {
            continue; // Skip small reads
          }

          if (pendingAction?.type === tool.name) {
            const existing = pendingAction.files.get(filename);
            if (existing) {
              existing.ranges.push(lineRange);
            } else {
              pendingAction.files.set(filename, { ranges: [lineRange] });
            }
            pendingAction.totalBytes += bytes;
            pendingAction.cost += entryCost;
            pendingAction.endTime = entry.timestamp;
          } else {
            flushPending();
            pendingAction = {
              type: tool.name,
              files: new Map([[filename, { ranges: [lineRange] }]]),
              totalBytes: bytes,
              cost: entryCost,
              startTime: entry.timestamp,
              endTime: entry.timestamp
            };
          }
          continue;
        }

        // Flush pending RLE actions before non-RLE tool
        flushPending();

        let action = '';
        if (tool.name === 'Bash') {
          action = formatBashTool(tool, result, metadata);
        } else if (tool.name === 'Task') {
          action = formatTaskTool(tool, metadata);
        } else if (tool.name === 'AskUserQuestion') {
          action = formatAskUserQuestion(tool, result, metadata);
        } else if (tool.name === 'WebFetch') {
          action = formatWebFetch(tool, result, metadata);
        } else if (tool.name === 'WebSearch') {
          action = formatWebSearch(tool, result, metadata);
        } else if (isMcpTool) {
          action = formatMcpTool(tool, result, metadata);
        } else {
          // Fallback for unknown tools (blocklist approach makes this important)
          action = formatUnknownTool(tool, result, metadata);
        }

        if (action) {
          actions.push(`${lineNum}. ${action}`);
          lineNum++;
          prevTimestamp = entry.timestamp;
        }
      }

      // Add MessageEnd marker only for multi-tool messages
      if (!shouldInlineTokens && toolBlocks.length > 0 && usage && usage.input_tokens && usage.output_tokens) {
        flushPending(); // Flush any pending RLE actions before MessageEnd

        let timeMeta = '';
        if (prevTimestamp && entry.timestamp) {
          const duration = formatDuration(prevTimestamp, entry.timestamp);
          if (duration) timeMeta = `+${duration} `;
        }

        const messageEnd = `MessageEnd #${messageNum}: [${timeMeta}in=${usage.input_tokens}t out=${usage.output_tokens}t $${entryCost.toFixed(4)}]`;
        actions.push(messageEnd);
        // Note: Don't increment lineNum for MessageEnd - it's a marker, not a numbered action
        prevTimestamp = entry.timestamp;
      }
    }
  }

  flushPending();

  if (actions.length > 0) {
    const timeline = actions.join('\n');

    return {
      file: conv.filePath || 'unknown',
      timeline,
      entries: conv.entries
    };
  }

  return null;
}

// Process the conversation sent to this worker
if (parentPort) {
  try {
    const result = processConversation(workerData.conversation);
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
}
