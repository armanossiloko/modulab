import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';
import { FeedItem } from '../api/generated';

interface Story {
  title: string;
  url: string;
  thumb: string | null;
  domain: string | null;
  when: string | null;
  author: string | null;
  score: string | null;
  comments: string | null;
  discussionUrl: string | null;
}

@Component({
  selector: 'app-feed-widget',
  template: `
    @if (error()) {
      <p class="empty-note">{{ error() }}</p>
    } @else {
      <ul class="feed-list">
        @for (item of stories(); track item.url) {
          <li class="story" [class.story--media]="!!item.thumb">
            @if (item.thumb) {
              <a class="story__media" [href]="item.url" target="_blank" rel="noopener noreferrer">
                <img [src]="item.thumb" alt="" />
              </a>
            }
            <div class="story__body">
              <a class="story__title" [href]="item.url" target="_blank" rel="noopener noreferrer">{{
                item.title
              }}</a>
              @if (item.domain || item.when || item.author) {
                <p class="story__byline">
                  @if (item.domain) {
                    <span>{{ item.domain }}</span>
                  }
                  @if (item.when) {
                    <span>{{ item.when }}</span>
                  }
                  @if (item.author) {
                    <span>{{ item.author }}</span>
                  }
                </p>
              }
              @if (item.score || item.comments) {
                <p class="story__stats">
                  @if (item.score) {
                    <span>{{ item.score }} points</span>
                  }
                  @if (item.comments) {
                    @if (item.discussionUrl) {
                      <a [href]="item.discussionUrl" target="_blank" rel="noopener noreferrer"
                        >{{ item.comments }} comments</a
                      >
                    } @else {
                      <span>{{ item.comments }} comments</span>
                    }
                  }
                </p>
              }
            </div>
          </li>
        } @empty {
          <li class="empty-note">{{ loading() ? 'Loading…' : 'No items.' }}</li>
        }
      </ul>
    }
  `,
  styles: `
    .feed-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .story {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.75rem;
      padding: 0.75rem 0.8rem;
      border-radius: var(--radius);
      border: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--inset) 72%, transparent);
    }
    .story--media {
      grid-template-columns: 4.75rem minmax(0, 1fr);
      align-items: start;
    }
    .story__media {
      display: block;
      width: 4.75rem;
      height: 4.75rem;
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: var(--widget);
    }
    .story__media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .story__body {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
    }
    .story__title {
      color: var(--text);
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 650;
      line-height: 1.35;
      letter-spacing: -0.01em;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .story__title:hover {
      color: var(--accent);
    }
    .story__byline,
    .story__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem 0.7rem;
      margin: 0;
    }
    .story__byline {
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .story__byline span + span::before {
      content: '·';
      margin-right: 0.7rem;
      color: var(--text-dim);
    }
    .story__stats {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--text-dim);
    }
    .story__stats a {
      color: inherit;
      text-decoration: none;
    }
    .story__stats a:hover {
      color: var(--accent);
    }
  `,
})
export class FeedWidget implements OnInit {
  @Input() kind: 'hn' | 'reddit' = 'hn';
  @Input() config: Record<string, unknown> = {};

  private readonly dash = inject(DashboardService);
  readonly stories = signal<Story[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const typeKey = this.kind === 'hn' ? 'hackerNews' : 'community';
    const merged = { ...this.dash.widgetConfig(typeKey), ...this.config };
    const limit = Number(merged['limit'] ?? 5);

    const req =
      this.kind === 'hn'
        ? this.dash.hnFeed(limit)
        : this.dash.redditFeed(String((merged['communities'] as string[] | undefined)?.[0] ?? 'selfhosted'), limit);

    req.subscribe({
      next: (data) => {
        this.loading.set(false);
        this.stories.set((data.items ?? []).map(toStory));
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message);
      },
    });
  }
}

function toStory(item: FeedItem): Story {
  const parsed = splitMeta(item.meta);
  const score = num(item.score) ?? parsed.score;
  const comments = num(item.comments);
  const author = text(item.author) ?? parsed.author;
  const domain = text(item.domain) ?? hostOf(item.url);
  const discussion = text(item.discussionUrl);
  return {
    title: item.title,
    url: item.url,
    thumb: text(item.thumb),
    domain: domain && discussion && hostOf(discussion) === domain ? null : domain,
    when: relativeTime(item.publishedAt),
    author,
    score: score == null ? null : formatCount(score),
    comments: comments == null ? null : formatCount(comments),
    discussionUrl: discussion && discussion !== item.url ? discussion : null,
  };
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitMeta(meta: string | null | undefined): { score: number | null; author: string | null } {
  let score: number | null = null;
  let author: string | null = null;
  for (const part of (meta ?? '').split('·').map((s) => s.trim()).filter(Boolean)) {
    const points = part.match(/^([\d,.]+)\s*pts?$/i);
    const plain = part.match(/^[\d,.]+$/);
    const user = part.match(/^u\/(.+)$/i);
    if (points) score = Number(points[1].replace(/,/g, ''));
    else if (plain) score = Number(part.replace(/,/g, ''));
    else if (user) author = user[1];
    else if (!author) author = part;
  }
  return { score, author };
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function formatCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function relativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
