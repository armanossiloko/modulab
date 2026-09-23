import { Component, Input } from '@angular/core';
import { Icon } from '../shared/icon';

interface LinkItem {
  title: string;
  url: string;
}

@Component({
  selector: 'app-links-widget',
  imports: [Icon],
  template: `
    <ul class="links">
      @for (link of links; track link.url) {
        <li>
          <a class="link" [href]="link.url" target="_blank" rel="noopener noreferrer">
            <span class="link-title">{{ link.title || link.url }}</span>
            <app-icon name="external" [size]="13" />
          </a>
        </li>
      } @empty {
        <li class="empty-note">No links configured.</li>
      }
    </ul>
  `,
  styles: `
    :host {
      overflow: auto;
    }
    .links {
      list-style: none;
      margin: 0 -0.45rem;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      height: 30px;
      padding: 0 0.45rem;
      border-radius: var(--radius-sm);
      color: var(--text);
      text-decoration: none;
      font-weight: 500;
      font-size: var(--fs-md);
      transition:
        background 0.15s,
        color 0.15s;
    }
    .link app-icon {
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .link:hover {
      background: var(--inset);
      color: var(--accent);
    }
    .link:hover app-icon {
      opacity: 1;
    }
    .link-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class LinksWidget {
  links: LinkItem[] = [];

  @Input() set config(value: Record<string, unknown>) {
    const raw = value?.['links'];
    if (!Array.isArray(raw)) {
      this.links = [];
      return;
    }
    this.links = raw
      .map((l) => {
        const row = l as Record<string, unknown>;
        return {
          title: String(row['title'] ?? ''),
          url: String(row['url'] ?? ''),
        };
      })
      .filter((l) => l.url);
  }
}
