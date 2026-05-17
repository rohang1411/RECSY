export type SourceThumbnail =
  | {
      kind: 'image';
      src: string;
      label: string;
      detail: string;
    }
  | {
      kind: 'tile';
      label: string;
      detail: string;
    };

export type SourceThumbnailInput = {
  type: string;
  url: string;
  title: string;
  author?: string | null;
  channel?: string | null;
};

export function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    if (host.endsWith('youtube.com')) {
      const id = parsed.searchParams.get('v');
      if (id) return id;
      const parts = parsed.pathname.split('/').filter(Boolean);
      const shortsIndex = parts.findIndex((part) => part === 'shorts' || part === 'embed');
      if (shortsIndex >= 0) return parts[shortsIndex + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function getSourceThumbnail(source: SourceThumbnailInput): SourceThumbnail {
  const domain = getDomain(source.url);

  if (source.type === 'youtube') {
    const id = getYouTubeVideoId(source.url);
    if (id) {
      return {
        kind: 'image',
        src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        label: source.title,
        detail: source.channel ?? source.author ?? domain ?? 'youtube.com',
      };
    }
  }

  let detail = source.channel ?? source.author ?? '';
  detail ||= domain ?? source.type;

  if (domain && source.type !== 'reddit') {
    return {
      kind: 'image',
      src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
      label: source.title,
      detail,
    };
  }

  return {
    kind: 'tile',
    label: source.type === 'gsmarena' ? 'GSMArena' : source.type,
    detail,
  };
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
