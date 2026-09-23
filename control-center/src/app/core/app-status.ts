export type StatusTone = 'positive' | 'accent' | 'negative' | 'neutral';

export function statusLabel(status?: string | null): string {
  if (!status) return 'unknown';
  if (status === 'removed') return 'not running';
  return status;
}

const FLOATING_TAGS = new Set([
  'latest',
  'stable',
  'main',
  'master',
  'release',
  'local',
  'edge',
  'nightly',
  'dev',
  'develop',
]);

/** Installed release: pinned version plus the image build date. */
export function formatRelease(version?: string | null, releasedAt?: string | null): string | null {
  const versionText = version?.trim();
  const showVersion =
    !!versionText && !FLOATING_TAGS.has(versionText.toLowerCase());
  const dateText = formatReleaseDate(releasedAt);
  if (showVersion && dateText) return `${versionText} · ${dateText}`;
  if (showVersion) return versionText!;
  return dateText;
}

export function formatReleaseDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function statusTone(status?: string | null): StatusTone {
  switch (status) {
    case 'running':
      return 'positive';
    case 'available':
      return 'accent';
    case 'removed':
      return 'negative';
    default:
      return 'neutral';
  }
}
