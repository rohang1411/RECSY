/**
 * Low-Overhead Media & YouTube Verification Engine (Plan 31 WP-08).
 *
 * Provides regex syntax validation and asynchronous, zero-quota HTTP HEAD checks
 * against YouTube's public oEmbed endpoint (< 1KB per check, 0 tokens, 0 API keys).
 */

export const YOUTUBE_CHANNEL_ID_REGEX = /^UC[a-zA-Z0-9_-]{22}$/;
export const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
export const YOUTUBE_URL_VIDEO_ID_REGEX =
  /(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function isValidYouTubeChannelId(channelId: string): boolean {
  if (!channelId) return false;
  return YOUTUBE_CHANNEL_ID_REGEX.test(channelId.trim());
}

export function isValidYouTubeVideoId(videoId: string): boolean {
  if (!videoId) return false;
  return YOUTUBE_VIDEO_ID_REGEX.test(videoId.trim());
}

export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  const match = url.match(YOUTUBE_URL_VIDEO_ID_REGEX);
  return match ? match[1]! : null;
}

export interface VideoVerificationResult {
  readonly videoId: string;
  readonly status: 'verified' | 'not_found' | 'restricted' | 'error';
  readonly httpStatus: number;
}

/**
 * Checks YouTube video availability via official public oEmbed endpoint with HEAD request.
 * Does not download heavy HTML watch pages or consume Gemini/YouTube API quotas.
 */
export async function verifyYouTubeVideoOembed(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoVerificationResult> {
  if (!isValidYouTubeVideoId(videoId)) {
    return { videoId, status: 'not_found', httpStatus: 400 };
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const res = await fetchImpl(oembedUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'RECSY-Health-Auditor/2.0' },
      signal: AbortSignal.timeout(4000),
    });

    if (res.status === 200) {
      return { videoId, status: 'verified', httpStatus: 200 };
    }
    if (res.status === 404) {
      return { videoId, status: 'not_found', httpStatus: 404 };
    }
    if (res.status === 401 || res.status === 403) {
      return { videoId, status: 'restricted', httpStatus: res.status };
    }

    return { videoId, status: 'error', httpStatus: res.status };
  } catch {
    return { videoId, status: 'error', httpStatus: 0 };
  }
}
