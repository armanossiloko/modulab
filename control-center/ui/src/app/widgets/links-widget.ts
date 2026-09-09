import { Component, Input } from '@angular/core';

interface LinkItem {
  title: string;
  url: string;
}

@Component({
  selector: 'app-links-widget',
  template: `
    <ul class="links">
      @for (link of links; track link.url) {
        <li>
          <a [href]="link.url" target="_blank" rel="noopener noreferrer">{{ link.title || link.url }}</a>
        </li>
      } @empty {
        <li class="empty-note">No links configured.</li>
      }
    </ul>
  `,
  styles: `
    .links {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .links a {
      color: var(--text);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.9rem;
    }
    .links a:hover {
      color: var(--accent);
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
