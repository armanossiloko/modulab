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
            <a [href]="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
            @if (item.meta) {
              <span class="feed-meta">{{ item.meta }}</span>
            }
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
      gap: 0.55rem;
      overflow: auto;
      max-height: 100%;
    }
    .feed-list a {
      color: var(--text);
      text-decoration: none;
      font-weight: 500;
    }
    .feed-list a:hover {
      color: var(--accent);
    }
    .feed-meta {
      display: block;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.15rem;
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
