export type McpErrorCategory = 'python_version_too_old' | 'python_module_missing';

export interface McpErrorDetail {
  category: McpErrorCategory | null;
  message: string;
  detectedVersion?: string;
  requiredVersion?: string;
  command?: string;
  missingModule?: string;
}

const VERSION_REQUIREMENT_PATTERNS: RegExp[] = [
  /requires\s+python\s*[>=]+\s*(\d+\.\d+)/i,
  /python[_-]requires[^0-9]*(\d+\.\d+)/i,
  /python\s+(\d+\.\d+)\+\s+is\s+required/i,
  /needs?\s+python\s*[>=]+\s*(\d+\.\d+)/i,
];

const VERSION_DETECTED_PATTERNS: RegExp[] = [
  /python\s+(\d+\.\d+)(?:\.\d+)?\s+(?:is\s+)?not\s+(?:supported|sufficient)/i,
  /your\s+python\s+(\d+\.\d+)/i,
];

const PYTHON_NOT_FOUND_PATTERNS: RegExp[] = [
  /python3?\s*:\s*command\s+not\s+found/i,
  /no\s+such\s+file\s+or\s+directory.*python/i,
  /spawn\s+python3?\s+ENOENT/i,
];

const SYNTAX_ERROR_FROM_OLD_PYTHON = /SyntaxError.*(?:walrus|:=|f-string|match\s+statement|async\s+def|positional-only)/i;

const MODULE_MISSING_PATTERN = /(?:ModuleNotFoundError|ImportError):\s*No module named\s+['"]([^'"]+)['"]/i;

export function classifyMcpStartupError(detail: string, command?: string): McpErrorDetail {
  const text = detail || '';

  const moduleMatch = MODULE_MISSING_PATTERN.exec(text);
  if (moduleMatch) {
    return {
      category: 'python_module_missing',
      message: text,
      missingModule: moduleMatch[1],
      command,
    };
  }

  for (const pattern of VERSION_REQUIREMENT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return {
        category: 'python_version_too_old',
        message: text,
        requiredVersion: match[1],
        command,
      };
    }
  }

  for (const pattern of VERSION_DETECTED_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return {
        category: 'python_version_too_old',
        message: text,
        detectedVersion: match[1],
        command,
      };
    }
  }

  if (SYNTAX_ERROR_FROM_OLD_PYTHON.test(text)) {
    return {
      category: 'python_version_too_old',
      message: text,
      command,
    };
  }

  if (command && /python/i.test(command)) {
    for (const pattern of PYTHON_NOT_FOUND_PATTERNS) {
      if (pattern.test(text)) {
        return {
          category: 'python_version_too_old',
          message: text,
          command,
        };
      }
    }
  }

  return { category: null, message: text, command };
}
