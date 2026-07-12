import { localMeetingSummaryConfigHash } from './meeting-local-transcriber.js';

export type MeetingModelLocality = 'local' | 'remote';
export type MeetingSummaryProvider = 'local-only' | string;
export type RecordingScenario = 'discussion' | 'meeting' | 'sales';

export interface MeetingModelBinding {
  providerId: string;
  modelId: string;
  locality: MeetingModelLocality;
  configHash: string;
}

export interface MeetingTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface SalesMeetingSummary {
  customerNeeds: string[];
  painPoints: string[];
  competitors: string[];
  commitments: string[];
  nextSteps: string[];
  amountsAndDates: string[];
  contacts: string[];
}

export interface MeetingSummary {
  title: string;
  scenario?: RecordingScenario;
  overview?: string[];
  attendees: string[];
  decisions: string[];
  actionItems: Array<{ owner?: string; text: string }>;
  sales?: SalesMeetingSummary;
}

export interface MeetingSummarizeInput {
  transcript: string;
  segments: MeetingTranscriptSegment[];
  summaryProvider: MeetingSummaryProvider;
  scenario?: RecordingScenario;
  consentSnapshot?: MeetingModelBinding;
}

export type MeetingSummaryResult =
  | { ok: true; summary: MeetingSummary; binding: MeetingModelBinding }
  | { ok: false; status: 'summary_blocked_by_privacy'; reason: 'local_model_required' | 'provider_changed'; binding: MeetingModelBinding };

export interface MeetingSummaryService {
  summarizeMeeting(input: MeetingSummarizeInput): Promise<MeetingSummaryResult>;
}

export interface MeetingSummaryServiceDeps {
  resolveBinding: (provider: MeetingSummaryProvider) => Promise<MeetingModelBinding> | MeetingModelBinding;
  summarizeTranscript: (input: {
    transcript: string;
    segments: MeetingTranscriptSegment[];
    scenario?: RecordingScenario;
    binding: MeetingModelBinding;
  }) => Promise<MeetingSummary> | MeetingSummary;
}

export function createMeetingSummaryService(deps: MeetingSummaryServiceDeps): MeetingSummaryService {
  return {
    async summarizeMeeting(input) {
      const binding = await deps.resolveBinding(input.summaryProvider);
      if (input.summaryProvider === 'local-only' && binding.locality !== 'local') {
        return { ok: false, status: 'summary_blocked_by_privacy', reason: 'local_model_required', binding };
      }

      if (input.consentSnapshot && !sameBinding(input.consentSnapshot, binding)) {
        return { ok: false, status: 'summary_blocked_by_privacy', reason: 'provider_changed', binding };
      }

      const summary = await deps.summarizeTranscript({
        transcript: input.transcript,
        segments: input.segments,
        scenario: input.scenario,
        binding,
      });
      return { ok: true, summary, binding };
    },
  };
}

export function createLocalMeetingSummaryService(): MeetingSummaryService {
  const binding: MeetingModelBinding = {
    providerId: 'xiaok-local',
    modelId: 'extractive-meeting-summary',
    locality: 'local',
    configHash: localMeetingSummaryConfigHash(),
  };
  return createMeetingSummaryService({
    resolveBinding: () => binding,
    summarizeTranscript: ({ transcript, segments, scenario }) => summarizeTranscriptLocally(transcript, segments, scenario),
  });
}

function summarizeTranscriptLocally(
  transcript: string,
  segments: MeetingTranscriptSegment[] = [],
  scenario: RecordingScenario = 'meeting',
): MeetingSummary {
  const sentences = splitTranscriptSentences(transcript, segments);
  const actionItems = extractActionItems(sentences);
  const decisions = extractDecisions(sentences);
  const overview = sentences.slice(0, 5);
  const sales = scenario === 'sales' ? extractSalesSummary(sentences) : undefined;
  return {
    title: buildLocalSummaryTitle(decisions, overview, actionItems, sales),
    scenario,
    overview,
    attendees: extractAttendees(transcript),
    decisions,
    actionItems,
    ...(sales ? { sales } : {}),
  };
}

function splitTranscriptSentences(transcript: string, segments: MeetingTranscriptSegment[] = []): string[] {
  const sourceTexts = shouldUseSegmentSentenceBoundaries(segments)
    ? segments.map(segment => segment.text)
    : [transcript || segments.map(segment => segment.text).join(' ')];
  const sentences = sourceTexts.flatMap(splitTranscriptUnit);
  return dedupeStrings(sentences).slice(0, 80);
}

function shouldUseSegmentSentenceBoundaries(segments: MeetingTranscriptSegment[]): boolean {
  if (!segments.length) return false;
  return segments.some(segment => /[。！？.!?]/.test(segment.text));
}

function splitTranscriptUnit(text: string): string[] {
  const normalized = normalizeMeetingText(text);
  if (!normalized) return [];
  const punctuationParts = normalized
    .replace(/([。！？.!?])\s*/g, '$1\n')
    .split(/\n+/)
    .map(part => part.trim())
    .filter(Boolean);
  return punctuationParts.map(ensureTerminalPunctuation).filter(Boolean);
}

function extractAttendees(transcript: string): string[] {
  const attendees = new Set<string>();
  for (const match of transcript.matchAll(/(?:^|\n)\s*([A-Z][a-zA-Z]{1,24}|[\u4e00-\u9fff]{2,4})[:：]/g)) {
    attendees.add(match[1]);
  }
  return Array.from(attendees).slice(0, 12);
}

function extractActionItems(sentences: string[]): MeetingSummary['actionItems'] {
  const actionItems: MeetingSummary['actionItems'] = [];
  for (const sentence of sentences) {
    if (isLikelyRawUnpunctuatedChineseSentence(sentence)) continue;
    const english = sentence.match(/^\s*([A-Z][a-zA-Z]{1,24})\s+(?:will|should|needs? to|is going to)\s+(.+?)[。.!?]?\s*$/i);
    if (english) {
      actionItems.push({ owner: english[1], text: ensureTerminalPunctuation(english[2]) });
      continue;
    }
    const chinese = sentence.match(/^\s*([\u4e00-\u9fff]{2,4})\s*(?:负责|需要|需|会|将)(.+?)[。！？.!?]?\s*$/);
    if (chinese && isLikelyPersonName(chinese[1])) {
      actionItems.push({ owner: chinese[1], text: ensureTerminalPunctuation(chinese[2]) });
    }
  }
  const seen = new Set<string>();
  return actionItems.filter((item) => {
    const key = `${item.owner ?? ''}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function extractDecisions(sentences: string[]): string[] {
  const decisions = sentences.filter(sentence => isDecisionSentence(sentence));
  return dedupeStrings(decisions).slice(0, 8);
}

function isDecisionSentence(sentence: string): boolean {
  if (isLikelyRawUnpunctuatedChineseSentence(sentence)) return false;
  if (/^\s*[\u4e00-\u9fff]{2,4}\s*(?:负责|需要|需|会|将)/.test(sentence)) return false;
  return /(?:决定|决议|同意|达成一致|decided|decision|agreed)/i.test(sentence)
    || /(?:我们|大家|团队|会议|本次)(?:确认|明确)/.test(sentence);
}

function buildLocalSummaryTitle(
  decisions: string[],
  overview: string[],
  actionItems: MeetingSummary['actionItems'],
  sales?: SalesMeetingSummary,
): string {
  const candidate = firstRecognized(sales?.customerNeeds)
    ?? decisions[0]
    ?? overview[0]
    ?? actionItems[0]?.text
    ?? '';
  return cleanupTitle(candidate);
}

function extractSalesSummary(sentences: string[]): SalesMeetingSummary {
  const reliableSentences = sentences.filter(sentence => !isLikelyRawUnpunctuatedChineseSentence(sentence));
  const customerNeeds = filterRecognized(reliableSentences.filter(sentence => /(?:客户|对方).*(?:需要|希望|想要|关注)/.test(sentence)));
  const painPoints = filterRecognized(reliableSentences.filter(sentence => /(?:痛点|担心|顾虑|异议|问题|风险)/.test(sentence)));
  const competitors = filterRecognized(reliableSentences.filter(sentence => /(?:竞品|替代|友商|对比|方案)/.test(sentence)));
  const commitments = filterRecognized(reliableSentences.filter(sentence => /(?:承诺|我们.*(?:提供|发送|安排|跟进)|我方.*(?:提供|发送|安排|跟进))/i.test(sentence)));
  const nextSteps = filterRecognized(reliableSentences.filter(sentence => /(?:下一步|后续|下周|明天|周[一二三四五六日天])/.test(sentence)));
  const amountsAndDates = filterRecognized(reliableSentences.filter(sentence => /(?:\d+(?:\.\d+)?\s*(?:万|元|块|k|K)|[一二三四五六七八九十百千万]+(?:万|元|块)|(?:明天|后天|下周|周[一二三四五六日天]|\d{1,2}月\d{1,2}日))/.test(sentence)));
  const contacts = filterRecognized(reliableSentences.filter(sentence => /(?:联系人|负责人|对接人|采购|老板|总|经理)/.test(sentence)));
  return {
    customerNeeds: withUnknown(customerNeeds),
    painPoints: withUnknown(painPoints),
    competitors: withUnknown(competitors),
    commitments: withUnknown(commitments),
    nextSteps: withUnknown(nextSteps),
    amountsAndDates: withUnknown(amountsAndDates),
    contacts: withUnknown(contacts),
  };
}

function filterRecognized(values: string[]): string[] {
  return dedupeStrings(values.map(cleanupTitle).filter(Boolean)).slice(0, 6);
}

function withUnknown(values: string[]): string[] {
  return values.length ? values : ['未识别'];
}

function firstRecognized(values?: string[]): string | undefined {
  return values?.find(value => value && value !== '未识别');
}

function cleanupTitle(text: string): string {
  return text
    .replace(/^[\s-*]+/, '')
    .replace(/^(?:我们|大家|团队|会议|本次)?(?:决定|决议|同意|确认|明确)\s*/, '')
    .replace(/[。！？.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

function normalizeMeetingText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureTerminalPunctuation(text: string): string {
  const normalized = normalizeMeetingText(text);
  if (!normalized) return '';
  if (/[。！？.!?]$/.test(normalized)) return normalized;
  return /[\u4e00-\u9fff]/.test(normalized) ? `${normalized}。` : `${normalized}.`;
}

function isLikelyRawUnpunctuatedChineseSentence(sentence: string): boolean {
  const body = sentence.replace(/[。！？.!?]+$/g, '').trim();
  if (body.length < 18 || !/[\u4e00-\u9fff]/.test(body)) return false;
  if (/[，、；：,.!?。！？]/.test(body)) return false;
  const markerMatches = body.match(/负责|需要|确认|提交|跟进|整理|输出|完成|同步|处理|支持|评估|发送|准备|记录|推进|沟通|决定|决议|同意|明确|下一步|后续|明天|下周/g);
  return (markerMatches?.length ?? 0) >= 2;
}

function isLikelyPersonName(value: string): boolean {
  return !new Set(['我们', '大家', '团队', '会议', '本次', '本周', '今天', '明天', '后续']).has(value);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function sameBinding(a: MeetingModelBinding, b: MeetingModelBinding): boolean {
  return a.providerId === b.providerId
    && a.modelId === b.modelId
    && a.locality === b.locality
    && a.configHash === b.configHash;
}
