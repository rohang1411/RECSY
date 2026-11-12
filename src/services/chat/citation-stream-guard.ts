/**
 * CitationStreamGuard (Plan 26 WP-06).
 *
 * Real-time token stream guard for citation tags:
 * - Emits text outside possible tags immediately.
 * - Buffers candidate tags starting with `[` (up to 40 chars).
 * - Complete valid tags referencing allowed retrieved chunks are emitted and reported via newlyCited.
 * - Hallucinated or invalid tags are stripped, stats.strippedTags incremented, and doubled spaces collapsed.
 * - Incomplete tags at flush starting with `[c:` are stripped; non-tags are emitted.
 * - Property invariant: validateCitationTags(guard.emitted, allowed).ok === true.
 */
export interface CitationGuardStats {
  readonly emittedTags: number;
  readonly strippedTags: number;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_TAG_LENGTH = 40; // [c: + 36 uuid + ]

export class CitationStreamGuard {
  private readonly allowedChunkIds: ReadonlySet<string>;
  private readonly seenCitedChunkIds = new Set<string>();
  private buffer = '';
  private fullEmitted = '';
  private emittedTagsCount = 0;
  private strippedTagsCount = 0;

  constructor(allowedChunkIds: ReadonlySet<string>) {
    const normalized = new Set<string>();
    for (const id of allowedChunkIds) {
      normalized.add(id.toLowerCase());
    }
    this.allowedChunkIds = normalized;
  }

  /** Accepts a raw model delta, returns text safe to emit now (may be ''). */
  public push(delta: string): { text: string; newlyCited: string[] } {
    this.buffer += delta;
    return this.processBuffer(false);
  }

  /** Ends the stream; returns any held-back text that is not a tag. */
  public flush(): { text: string; newlyCited: string[] } {
    return this.processBuffer(true);
  }

  public get stats(): CitationGuardStats {
    return {
      emittedTags: this.emittedTagsCount,
      strippedTags: this.strippedTagsCount,
    };
  }

  /** Full guarded text emitted so far (what will be persisted). */
  public get emitted(): string {
    return this.fullEmitted;
  }

  private processBuffer(isFlush: boolean): { text: string; newlyCited: string[] } {
    let output = '';
    const newlyCited: string[] = [];

    while (this.buffer.length > 0) {
      const openIdx = this.buffer.indexOf('[');

      // No bracket in buffer
      if (openIdx === -1) {
        output += this.buffer;
        this.buffer = '';
        break;
      }

      // Emit anything before '[' immediately
      if (openIdx > 0) {
        output += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx);
      }

      // Now this.buffer starts with '['
      // If we are flushing and this cannot be a completed tag:
      if (isFlush) {
        const closeIdx = this.buffer.indexOf(']');
        if (closeIdx === -1 || closeIdx > MAX_TAG_LENGTH - 1) {
          if (this.isPrefixOfCitationTag(this.buffer)) {
            // Cut off partial citation tag at EOF
            if (this.buffer.toLowerCase().startsWith('[c:')) {
              this.strippedTagsCount++;
            }
            this.buffer = '';
          } else {
            // Plain text containing '['
            output += this.buffer;
            this.buffer = '';
          }
          break;
        }
      }

      // Check if buffer is still potentially a citation tag
      if (!this.isPrefixOfCitationTag(this.buffer)) {
        output += '[';
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // It is a valid prefix. Does it have a closing bracket ']'?
      const closeIdx = this.buffer.indexOf(']');
      if (closeIdx === -1) {
        if (this.buffer.length >= MAX_TAG_LENGTH) {
          // Exceeded max length without finding ']'
          output += '[';
          this.buffer = this.buffer.slice(1);
          continue;
        }
        // Still waiting for more characters
        break;
      }

      // We have '[' at 0 and ']' at closeIdx
      if (closeIdx > MAX_TAG_LENGTH - 1) {
        output += '[';
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // Potential full tag
      const rawTag = this.buffer.slice(0, closeIdx + 1);
      const isTagFormat =
        rawTag.toLowerCase().startsWith('[c:') && UUID_REGEX.test(rawTag.slice(3, -1));

      if (!isTagFormat) {
        // Not a valid UUID format
        output += '[';
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // Valid tag format!
      const chunkId = rawTag.slice(3, -1).toLowerCase();
      let charsToConsume = closeIdx + 1;

      if (this.allowedChunkIds.has(chunkId)) {
        // Allowed tag
        output += rawTag;
        this.emittedTagsCount++;
        if (!this.seenCitedChunkIds.has(chunkId)) {
          this.seenCitedChunkIds.add(chunkId);
          newlyCited.push(chunkId);
        }
      } else {
        // Disallowed tag - strip it!
        this.strippedTagsCount++;

        // Collapse doubled space if left behind:
        const lastEmittedChar =
          output.length > 0
            ? output.charAt(output.length - 1)
            : this.fullEmitted.length > 0
              ? this.fullEmitted.charAt(this.fullEmitted.length - 1)
              : '';

        const nextChar = this.buffer.charAt(charsToConsume);
        if (lastEmittedChar === ' ' && nextChar === ' ') {
          charsToConsume++;
        }
      }

      this.buffer = this.buffer.slice(charsToConsume);
    }

    this.fullEmitted += output;
    return { text: output, newlyCited };
  }

  private isPrefixOfCitationTag(str: string): boolean {
    if (!str.startsWith('[')) return false;
    if (str.length === 1) return true; // '['

    const char1 = str.charAt(1).toLowerCase();
    if (char1 !== 'c') return false; // must be 'c' or 'C'
    if (str.length === 2) return true; // '[c'

    const char2 = str.charAt(2);
    if (char2 !== ':') return false; // must be ':'
    if (str.length === 3) return true; // '[c:'

    for (let i = 3; i < str.length && i < MAX_TAG_LENGTH; i++) {
      const ch = str.charAt(i);
      if (ch === ']') {
        return true;
      }
      const isHexOrDash =
        (ch >= '0' && ch <= '9') ||
        (ch >= 'a' && ch <= 'f') ||
        (ch >= 'A' && ch <= 'F') ||
        ch === '-';
      if (!isHexOrDash) {
        return false;
      }
    }

    return str.length <= MAX_TAG_LENGTH;
  }
}
