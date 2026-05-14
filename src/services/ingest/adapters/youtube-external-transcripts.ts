import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { env } from '@/env';
import { logger } from '@/services/logger';

import { parseJson3Transcript, type TranscriptSegment } from './youtube-transcript';

interface ExternalTranscriptResult {
  readonly provider: 'yt-dlp' | 'youtube-transcript-api';
  readonly segments: TranscriptSegment[];
}

interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

const MAX_CAPTURE_CHARS = 120_000;
const YTDLP_EXTENSIONS = new Set(['.json3', '.vtt', '.srt', '.srv3', '.xml']);
const log = logger.child({ component: 'ingest.adapter.youtube.external-transcripts' });
let nextExternalCallAt = 0;

/**
 * Last-mile transcript fallbacks for YouTube videos.
 *
 * These run only after the in-process `youtubei.js` + `timedtext` strategies
 * fail. To reduce YouTube account/IP risk, both fallbacks are conservative:
 * subtitles only, no audio/video download, short timeouts, one retry max, and
 * a process-wide delay between external transcript attempts.
 */
export async function fetchExternalTranscript(
  videoId: string,
  videoUrl: string,
): Promise<ExternalTranscriptResult | null> {
  if (!env.YOUTUBE_TRANSCRIPT_EXTERNAL_ENABLED) return null;

  const ytDlp = await fetchWithYtDlp(videoId, videoUrl);
  if (ytDlp) return ytDlp;

  return fetchWithYoutubeTranscriptApi(videoId);
}

async function fetchWithYtDlp(
  videoId: string,
  videoUrl: string,
): Promise<ExternalTranscriptResult | null> {
  if (!env.YTDLP_ENABLED) return null;

  for (const command of ytDlpCommands()) {
    await waitForExternalBudget();
    const workDir = await mkdtemp(path.join(tmpdir(), 'recsy-ytdlp-'));
    try {
      const cookiesFile = await materializeCookiesFile(workDir);
      const args = buildYtDlpArgs(videoUrl, workDir, cookiesFile);
      const result = await runCommand(
        command.cmd,
        [...command.prefixArgs, ...args],
        env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS,
      );
      const parsed = await readYtDlpSubtitleFiles(workDir);
      if (parsed.length > 0) {
        log.info({ videoId, provider: 'yt-dlp', segments: parsed.length }, 'transcript loaded');
        return { provider: 'yt-dlp', segments: parsed };
      }

      log.debug(
        {
          videoId,
          provider: 'yt-dlp',
          cmd: command.cmd,
          code: result.code,
          timedOut: result.timedOut,
          spawnError: result.spawnError,
          stderr: summarizeForLog(result.stderr),
        },
        'yt-dlp transcript fallback returned empty',
      );
      if (!isMissingCommand(result)) return null;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return null;
}

function ytDlpCommands(): Array<{ cmd: string; prefixArgs: string[] }> {
  const configured = env.YTDLP_PATH;
  if (configured !== 'yt-dlp') return [{ cmd: configured, prefixArgs: [] }];
  return [
    { cmd: 'yt-dlp', prefixArgs: [] },
    { cmd: env.YOUTUBE_TRANSCRIPT_PYTHON, prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'py', prefixArgs: ['-3', '-m', 'yt_dlp'] },
  ];
}

function buildYtDlpArgs(videoUrl: string, workDir: string, cookiesFile: string | null): string[] {
  const args = [
    '--no-config',
    '--no-playlist',
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    'en.*,en',
    '--sub-format',
    'json3/vtt/srv3/srt/best',
    '--socket-timeout',
    String(Math.ceil(env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS / 1_000)),
    '--retries',
    '1',
    '--fragment-retries',
    '1',
    '--sleep-requests',
    String(env.YTDLP_SLEEP_REQUESTS_SECONDS),
    '-o',
    path.join(workDir, '%(id)s.%(ext)s'),
  ];

  if (cookiesFile) args.push('--cookies', cookiesFile);
  if (env.YTDLP_PROXY) args.push('--proxy', env.YTDLP_PROXY);
  if (env.YTDLP_EXTRACTOR_ARGS) args.push('--extractor-args', env.YTDLP_EXTRACTOR_ARGS);

  args.push(videoUrl);
  return args;
}

async function materializeCookiesFile(workDir: string): Promise<string | null> {
  if (env.YTDLP_COOKIES_FILE) return env.YTDLP_COOKIES_FILE;
  if (!env.YTDLP_COOKIES_BASE64) return null;

  const file = path.join(workDir, 'youtube-cookies.txt');
  await writeFile(file, Buffer.from(env.YTDLP_COOKIES_BASE64, 'base64'), { mode: 0o600 });
  return file;
}

async function readYtDlpSubtitleFiles(workDir: string): Promise<TranscriptSegment[]> {
  const entries = await readdir(workDir, { withFileTypes: true });
  const subtitleFiles = entries
    .filter((entry) => entry.isFile() && YTDLP_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(workDir, entry.name))
    .sort(rankSubtitleFile);

  for (const file of subtitleFiles) {
    const text = await readFile(file, 'utf8');
    const parsed = parseCaptionText(text, path.extname(file));
    if (parsed.length > 0) return parsed;
  }
  return [];
}

function rankSubtitleFile(a: string, b: string): number {
  const priority: Record<string, number> = {
    '.json3': 0,
    '.vtt': 1,
    '.srt': 2,
    '.srv3': 3,
    '.xml': 4,
  };
  return (priority[path.extname(a)] ?? 99) - (priority[path.extname(b)] ?? 99);
}

async function fetchWithYoutubeTranscriptApi(
  videoId: string,
): Promise<ExternalTranscriptResult | null> {
  if (!env.YOUTUBE_TRANSCRIPT_API_ENABLED) return null;

  const commands = pythonCommands();
  for (const command of commands) {
    await waitForExternalBudget();
    const result = await runCommand(
      command.cmd,
      [...command.prefixArgs, '-c', PYTHON_TRANSCRIPT_SCRIPT, videoId],
      env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS,
    );
    const parsed = parsePythonTranscriptApiOutput(result.stdout);
    if (parsed.length > 0) {
      log.info(
        { videoId, provider: 'youtube-transcript-api', segments: parsed.length },
        'transcript loaded',
      );
      return { provider: 'youtube-transcript-api', segments: parsed };
    }

    log.debug(
      {
        videoId,
        provider: 'youtube-transcript-api',
        cmd: command.cmd,
        code: result.code,
        timedOut: result.timedOut,
        spawnError: result.spawnError,
        stderr: summarizeForLog(result.stderr),
      },
      'youtube-transcript-api fallback returned empty',
    );
  }

  return null;
}

function pythonCommands(): Array<{ cmd: string; prefixArgs: string[] }> {
  const configured = env.YOUTUBE_TRANSCRIPT_PYTHON;
  if (configured !== 'python') return [{ cmd: configured, prefixArgs: [] }];
  return [
    { cmd: 'python', prefixArgs: [] },
    { cmd: 'python3', prefixArgs: [] },
    { cmd: 'py', prefixArgs: ['-3'] },
  ];
}

function parsePythonTranscriptApiOutput(stdout: string): TranscriptSegment[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const text = typeof row.text === 'string' ? normaliseCaptionText(row.text) : '';
        const startMs = secondsToMs(row.start);
        const durationMs = secondsToMs(row.duration);
        if (!text || !Number.isFinite(startMs)) return null;
        return {
          text,
          startMs,
          endMs: startMs + (Number.isFinite(durationMs) ? durationMs : 0),
        };
      })
      .filter((segment): segment is TranscriptSegment => segment !== null);
  } catch {
    return [];
  }
}

export function parseCaptionText(text: string, extension: string): TranscriptSegment[] {
  if (extension === '.json3') {
    try {
      return parseJson3Transcript(JSON.parse(text));
    } catch {
      return [];
    }
  }
  if (extension === '.vtt' || text.trimStart().startsWith('WEBVTT')) {
    return parseCueBlocks(text);
  }
  if (extension === '.srt') {
    return parseCueBlocks(text);
  }
  if (extension === '.srv3' || extension === '.xml' || text.includes('<text ')) {
    return parseSrv3Transcript(text);
  }
  return [];
}

function parseCueBlocks(text: string): TranscriptSegment[] {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const out: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIdx = lines.findIndex((line) => line.includes('-->'));
    if (timingIdx === -1) continue;

    const timing = lines[timingIdx]!;
    const [rawStart, rawEnd] = timing.split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const startMs = parseTimestampMs(rawStart ?? '');
    const endMs = parseTimestampMs(rawEnd ?? '');
    const captionText = normaliseCaptionText(lines.slice(timingIdx + 1).join(' '));
    if (!captionText || !Number.isFinite(startMs)) continue;
    out.push({
      text: captionText,
      startMs,
      endMs: Number.isFinite(endMs) ? endMs : startMs,
    });
  }
  return out;
}

function parseSrv3Transcript(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  for (const match of text.matchAll(re)) {
    const attrs = match[1] ?? '';
    const rawText = match[2] ?? '';
    const start = /(?:^|\s)start="([^"]+)"/.exec(attrs)?.[1];
    const dur = /(?:^|\s)dur="([^"]+)"/.exec(attrs)?.[1];
    const startMs = secondsToMs(start);
    const durationMs = secondsToMs(dur);
    const captionText = normaliseCaptionText(rawText);
    if (!captionText || !Number.isFinite(startMs)) continue;
    out.push({
      text: captionText,
      startMs,
      endMs: startMs + (Number.isFinite(durationMs) ? durationMs : 0),
    });
  }
  return out;
}

function parseTimestampMs(raw: string): number {
  const clean = raw.replace(',', '.');
  const parts = clean.split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  if (![hours, minutes, seconds].every(Number.isFinite)) return Number.NaN;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1_000);
}

function secondsToMs(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.round(n * 1_000) : Number.NaN;
}

function normaliseCaptionText(text: string): string {
  return decodeEntities(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

async function waitForExternalBudget(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextExternalCallAt - now);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextExternalCallAt = Date.now() + env.YOUTUBE_TRANSCRIPT_EXTERNAL_MIN_GAP_MS;
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (err) => {
      finish({ code: null, stdout, stderr, timedOut, spawnError: err.message });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAX_CAPTURE_CHARS) return current;
  return (current + chunk.toString('utf8')).slice(0, MAX_CAPTURE_CHARS);
}

function isMissingCommand(result: CommandResult): boolean {
  return (
    result.spawnError?.includes('ENOENT') === true ||
    result.spawnError?.includes('not found') === true
  );
}

function summarizeForLog(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

const PYTHON_TRANSCRIPT_SCRIPT = String.raw`
import json
import sys

video_id = sys.argv[1]
languages = ["en", "en-US", "en-GB"]

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(3)

def as_dict(item):
    if isinstance(item, dict):
        return {
            "text": item.get("text", ""),
            "start": item.get("start", 0),
            "duration": item.get("duration", 0),
        }
    return {
        "text": getattr(item, "text", ""),
        "start": getattr(item, "start", 0),
        "duration": getattr(item, "duration", 0),
    }

try:
    try:
        transcript = YouTubeTranscriptApi().fetch(
            video_id,
            languages=languages,
            preserve_formatting=False,
        )
    except TypeError:
        transcript = YouTubeTranscriptApi.get_transcript(
            video_id,
            languages=languages,
            preserve_formatting=False,
        )
    print(json.dumps([as_dict(item) for item in transcript]))
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(2)
`;
