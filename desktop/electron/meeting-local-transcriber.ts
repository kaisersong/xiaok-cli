import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getConfigDir } from '../../src/utils/config.js';
import { createMeetingModelService, type MeetingModelService } from './meeting-model-service.js';
import { buildPythonServerEnv } from './python-runtime.js';
import type { MeetingTranscriber, MeetingTranscriptionResult } from './meeting-service.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = 'base';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type MeetingTranscriberExec = (
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<unknown>;

export interface LocalMeetingTranscriberOptions {
  pythonCommand?: string;
  scriptPath?: string;
  model?: string;
  language?: string;
  timeoutMs?: number;
  exec?: MeetingTranscriberExec;
  modelService?: Pick<MeetingModelService, 'listModels'>;
}

export function createLocalMeetingTranscriber(options: LocalMeetingTranscriberOptions = {}): MeetingTranscriber {
  const exec = options.exec ?? execFileAsync;
  const modelService = options.modelService ?? createMeetingModelService();
  const pythonCommand = options.pythonCommand
    ?? process.env.XIAOK_MEETING_TRANSCRIBER_PYTHON
    ?? (process.platform === 'win32' ? 'python' : 'python3');
  const scriptPath = resolveMeetingTranscriberScript(options.scriptPath);
  const model = options.model ?? process.env.XIAOK_MEETING_WHISPER_MODEL ?? DEFAULT_MODEL;
  const timeout = options.timeoutMs ?? Number(process.env.XIAOK_MEETING_TRANSCRIBE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  return {
    async transcribeFile(input) {
      assertMeetingModelReady(modelService, model);
      const args = [
        scriptPath,
        'transcribe-file',
        input.audioFilePath,
        '--meeting-id',
        input.meetingId,
        '--model',
        model,
      ];
      if (options.language?.trim()) {
        args.push('--language', options.language.trim());
      }

      let result: unknown;
      try {
        result = await exec(pythonCommand, args, {
          timeout,
          env: {
            ...buildPythonServerEnv(process.env as Record<string, string>),
            XIAOK_MEETING_TRANSCRIBER: '1',
          },
        });
      } catch (error) {
        throw new Error(readTranscriberFailure(error));
      }

      return parseTranscriberStdout(readExecStdout(result));
    },
  };
}

function assertMeetingModelReady(modelService: Pick<MeetingModelService, 'listModels'>, modelId: string): void {
  const model = modelService.listModels().find(item => item.id === modelId);
  if (!model) {
    throw new Error('whisper_model_not_downloaded');
  }
  if (model.status === 'downloaded') return;
  if (model.status === 'incomplete') {
    throw new Error('whisper_model_incomplete');
  }
  throw new Error('whisper_model_not_downloaded');
}

export function resolveMeetingTranscriberScript(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  const envPath = process.env.XIAOK_MEETING_TRANSCRIBER_SCRIPT;
  if (envPath) return envPath;

  const relative = join('kai-meeting-assistant', 'mcp-servers', 'meeting-transcriber', 'server.py');
  const candidates = [
    join(getConfigDir('plugins'), relative),
    join(process.cwd(), '..', '..', 'kai-xiaok-plugins', 'plugins', relative),
    join(process.cwd(), '..', 'kai-xiaok-plugins', 'plugins', relative),
    join(__dirname, '..', '..', '..', '..', '..', '..', 'kai-xiaok-plugins', 'plugins', relative),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
}

export function localMeetingSummaryConfigHash(): string {
  return createHash('sha256').update('xiaok-local:extractive-meeting-summary:v1').digest('hex');
}

function parseTranscriberStdout(stdout: string): MeetingTranscriptionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(stdout));
  } catch {
    throw new Error('invalid_transcriber_output');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_transcriber_output');
  }
  const record = parsed as Record<string, unknown>;
  const text = typeof record.text === 'string' ? normalizeTranscriptText(record.text.trim()) : '';
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];
  const segments = rawSegments.flatMap((segment) => {
    if (!segment || typeof segment !== 'object') return [];
    const value = segment as Record<string, unknown>;
    const start = Number(value.start);
    const end = Number(value.end);
    const segmentText = typeof value.text === 'string' ? normalizeTranscriptText(value.text.trim()) : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || !segmentText) return [];
    return [{ start, end, text: segmentText }];
  });

  if (!text && segments.length === 0) {
    throw new Error('empty_transcription');
  }

  return {
    text: text || segments.map(segment => segment.text).join(' '),
    segments: segments.length ? segments : [{ start: 0, end: 0, text }],
  };
}

const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  會: '会', 議: '议', 記: '记', 錄: '录', 張: '张', 負: '负', 責: '责', 後: '后', 續: '续', 進: '进',
  轉: '转', 寫: '写', 錯: '错', 麥: '麦', 風: '风', 開: '开', 關: '关', 內: '内', 總: '总',
  結: '结', 標: '标', 題: '题', 時: '时', 間: '间', 實: '实', 現: '现', 測: '测', 試: '试',
  資: '资', 識: '识', 庫: '库', 點: '点', 擊: '击', 彈: '弹', 視: '视', 覺: '觉', 狀: '状',
  態: '态', 處: '处', 檔: '档', 訊: '讯', 補: '补', 顯: '显', 應: '应', 該: '该', 預: '预',
  設: '设', 認: '认', 證: '证', 權: '权', 讀: '读', 儲: '储', 發: '发', 當: '当', 問: '问',
  決: '决', 費: '费', 優: '优', 雲: '云', 機: '机', 學: '学', 習: '习', 聽: '听', 說: '说',
  話: '话', 員: '员', 與: '与', 對: '对', 導: '导', 匯: '汇', 報: '报', 將: '将', 產: '产',
  經: '经', 線: '线', 體: '体', 驗: '验', 無: '无', 雙: '双', 單: '单', 刪: '删', 變: '变',
  檢: '检', 徑: '径', 週: '周',
  這: '这', 裡: '里', 個: '个', 們: '们', 為: '为', 於: '于', 從: '从', 編: '编', 號: '号',
};

function normalizeTranscriptText(text: string): string {
  let normalized = '';
  for (const char of text) {
    normalized += TRADITIONAL_TO_SIMPLIFIED[char] ?? char;
  }
  return normalized;
}

function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const jsonLine = trimmed.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
  return jsonLine?.trim() ?? trimmed;
}

function readTranscriberFailure(error: unknown): string {
  const stderr = readErrorStream(error, 'stderr');
  const stdout = readErrorStream(error, 'stdout');
  const structured = parseStructuredError(stderr) ?? parseStructuredError(stdout);
  if (structured) return structured;
  if (stderr.trim()) return stderr.trim().slice(0, 500);
  if (error instanceof Error && error.message) return error.message;
  return 'local_transcriber_failed';
}

function parseStructuredError(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // stderr may contain normal logs before/after the JSON payload.
  }
  return null;
}

function readErrorStream(error: unknown, key: 'stderr' | 'stdout'): string {
  if (!error || typeof error !== 'object' || !(key in error)) return '';
  const value = (error as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function readExecStdout(result: unknown): string {
  if (typeof result === 'string') return result;
  if (Buffer.isBuffer(result)) return result.toString('utf8');
  if (result && typeof result === 'object' && 'stdout' in result) {
    const stdout = (result as { stdout?: unknown }).stdout;
    if (typeof stdout === 'string') return stdout;
    if (Buffer.isBuffer(stdout)) return stdout.toString('utf8');
  }
  return '';
}
