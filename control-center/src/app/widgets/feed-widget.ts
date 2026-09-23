import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';
import { FeedItem } from '../api/generated';

@Component({
  selector: 'app-feed-widget',
  template: `
    @if (error()) {
      <p class="empty-note">{{ error() }}</p>
    } @else {
      <ul class="feed-list">
        @for (item of items(); track item.url) {
          <li>
            <a class="feed-item" [href]="item.url" target="_blank" rel="noopener noreferrer">
              <span class="feed-title">{{ item.title }}</span>
              @if (item.meta) {
                <span class="feed-meta">{{ item.meta }}</span>
              }
            </a>
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
      margin: 0 -0.45rem;
      padding: 0;
      display: flex;
      flex-direction: column;
      overflow: auto;
      max-height: 100%;
    }
    .feed-list li + li {
      border-top: 1px solid var(--border-soft);
    }
    .feed-item {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.45rem 0.45rem;
      border-radius: var(--radius-sm);
      color: var(--text);
      text-decoration: none;
      transition: background 0.15s;
    }
    .feed-item:hover {
      background: var(--inset);
    }
    .feed-title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: var(--fs-md);
      font-weight: 500;
      line-height: 1.35;
      transition: color 0.15s;
    }
    .feed-item:hover .feed-title {
      color: var(--accent);
    }
    .feed-meta {
      font-family: var(--mono);
      font-size: 0.68rem;
      color: var(--text-muted);
    }
  `,
})
export class FeedWidget implements OnInit {
  @Input() kind: 'hn' | 'reddit' = 'hn';
  @Input() config: Record<string, unknown> = {};

  private readonly dash = inject(DashboardService);
  readonly items = signal<FeedItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const typeKey = this.kind === 'hn' ? 'hackerNews' : 'community';
    const merged = { ...this.dash.widgetConfig(typeKey), ...this.config };
    const limit = Number(merged['limit'] ?? (this.kind === 'hn' ? 8 : 6));

    const req =
      this.kind === 'hn'
        ? this.dash.hnFeed(limit)
        : this.dash.redditFeed(String((merged['communities'] as string[] | undefined)?.[0] ?? 'selfhosted'), limit);

    req.subscribe({
      next: (data) => {
        this.loading.set(false);
        this.items.set(data.items ?? []);
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message);
      },
    });
  }
}
