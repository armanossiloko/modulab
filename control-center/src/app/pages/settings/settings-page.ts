import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardDocument } from '../../core/models/dashboard';

type SettingsSection = 'general' | 'sidebar';

const COLOR_TOKEN_HEX: Record<string, string> = {
  productivity: '#5b9bd9',
  media: '#e0894a',
  tools: '#4caf8f',
  infrastructure: '#a888c8',
  other: '#7a7a8a',
};

function toColorInput(value?: string): string {
  if (!value) return '#7a7a8a';
  if (value.startsWith('#')) return value.length === 7 ? value : '#d9a441';
  return COLOR_TOKEN_HEX[value] ?? '#7a7a8a';
}

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="settings">
      <header class="settings-head">
        <div>
          <h1>Settings</h1>
          <nav class="settings-tabs" aria-label="Settings sections">
            <a
              routerLink="/settings"
              class="settings-tab"
              [class.is-active]="section() === 'general'"
              >General</a
            >
            <a
              routerLink="/settings/sidebar"
              class="settings-tab"
              [class.is-active]="section() === 'sidebar'"
              >Shortcuts</a
            >
          </nav>
        </div>
        <button type="button" class="btn btn--primary" [disabled]="!dirty()" (click)="save()">
          Save
        </button>
      </header>

      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (draft) {
        @if (section() === 'general') {
          <div class="panel">
            <p class="lede">Brand and search defaults for Control Center.</p>
            <div class="settings-grid">
              <label class="field">
                <span>Title</span>
                <input [(ngModel)]="draft.title" (ngModelChange)="markDirty()" />
              </label>
              <label class="field field--inline">
                <span>Accent</span>
                <input type="color" [(ngModel)]="accent" (ngModelChange)="onAccent($event)" />
              </label>
              <label class="field">
                <span>Search engine URL <em>(%s = query)</em></span>
                <input [(ngModel)]="searchEngine" (ngModelChange)="onSearchEngine($event)" />
              </label>
              <label class="field">
                <span>Home search placeholder</span>
                <input
                  [ngModel]="draft.search?.placeholder || ''"
                  (ngModelChange)="onSearchPlaceholder($event)"
                />
              </label>
            </div>

            <h2>Dashboards</h2>
            <p class="muted">
              Manage boards in the sidebar (+ / nested). Edit widgets on a board with
              <strong>Edit layout</strong>. Shortcuts stay global.
            </p>
            <ul class="page-list">
              @for (page of draft.dashboards || draft.pages || []; track page.id) {
                <li>
                  <strong>{{ page.title }}</strong>
                  <span class="muted"
                    >{{ page.items.length }} widgets{{
                      page.parentId ? ' · nested' : ''
                    }}</span
                  >
                </li>
              }
            </ul>
          </div>
        }

        @if (section() === 'sidebar') {
          <div class="panel">
            <div class="panel-toolbar">
              <p class="lede">Reorder, rename, and color your sidebar shortcut groups.</p>
              <button type="button" class="btn" (click)="addGroup()">Add group</button>
            </div>

            @for (group of draft.sidebar?.bookmarks || []; track $index; let gi = $index) {
              <article class="group-card">
                <div class="group-head">
                  <label class="field">
                    <span>Group title</span>
                    <input [(ngModel)]="group.title" (ngModelChange)="markDirty()" />
                  </label>
                  <label class="field field--color">
                    <span>Color</span>
                    <input
                      type="color"
                      [ngModel]="toColorInput(group.color)"
                      (ngModelChange)="setGroupColor(gi, $event)"
                    />
                  </label>
                  <div class="group-actions">
                    <button
                      type="button"
                      class="btn btn--sm"
                      [disabled]="gi === 0"
                      (click)="moveGroup(gi, -1)"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm"
                      [disabled]="gi >= (draft.sidebar?.bookmarks?.length || 0) - 1"
                      (click)="moveGroup(gi, 1)"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm btn--danger"
                      (click)="removeGroup(gi)"
                      title="Delete group"
                    >
                      ×
                    </button>
                  </div>
                </div>

                @for (link of group.links; track $index; let li = $index) {
                  <div class="link-row">
                    <input
                      class="link-title"
                      placeholder="Title"
                      [(ngModel)]="link.title"
                      (ngModelChange)="markDirty()"
                    />
                    <input
                      class="link-url"
                      placeholder="https://"
                      [(ngModel)]="link.url"
                      (ngModelChange)="onLinkUrl(gi, li, $event)"
                    />
                    <button
                      type="button"
                      class="btn btn--sm btn--danger"
                      (click)="removeLink(gi, li)"
                      title="Remove link"
                    >
                      ×
                    </button>
                  </div>
                }

                <button type="button" class="btn btn--ghost btn--sm add-link" (click)="addLink(gi)">
                  Add link
                </button>
              </article>
            } @empty {
              <p class="empty-note">No shortcut groups yet. Add a group to get started.</p>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      overflow: auto;
    }
    .settings-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.15rem;
    }
    .settings-head h1 {
      margin: 0 0 0.55rem;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .settings-tabs {
      display: flex;
      gap: 0.25rem;
    }
    .settings-tab {
      padding: 0.35rem 0.7rem;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .settings-tab:hover {
      color: var(--text);
      background: hsl(240, 7%, 14%);
    }
    .settings-tab.is-active {
      color: var(--accent);
      background: var(--accent-soft);
    }
    .lede {
      margin: 0 0 1rem;
      color: var(--text-dim);
      font-size: 0.9rem;
    }
    .panel-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }
    .panel-toolbar .lede {
      margin: 0;
    }
    .settings-grid {
      display: grid;
      gap: 0.85rem;
      max-width: 480px;
      margin-bottom: 1.5rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.82rem;
      color: var(--text-dim);
      font-weight: 500;
    }
    .field em {
      font-style: normal;
      color: var(--text-muted);
      font-weight: 400;
    }
    .field input[type='text'],
    .field input:not([type]),
    .field input[type='url'],
    .field input[type='search'],
    .link-title,
    .link-url {
      height: var(--control-h);
      padding: 0 0.75rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      color: var(--text);
      font: inherit;
      font-weight: 400;
    }
    .field input:focus,
    .link-title:focus,
    .link-url:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .field--inline input[type='color'],
    .field--color input[type='color'] {
      width: 48px;
      height: 34px;
      padding: 0.15rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      cursor: pointer;
    }
    h2 {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin: 0 0 0.45rem;
    }
    .muted {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin: 0 0 0.65rem;
    }
    .page-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-width: 480px;
    }
    .page-list li {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.75rem 0.9rem;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border);
    }
    .group-card {
      margin-bottom: 0.85rem;
      padding: 0.9rem;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border);
    }
    .group-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 0.65rem;
      align-items: end;
      margin-bottom: 0.75rem;
    }
    .group-actions {
      display: flex;
      gap: 0.3rem;
    }
    .link-row {
      display: grid;
      grid-template-columns: minmax(100px, 160px) minmax(0, 1fr) auto;
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }
    .add-link {
      margin-top: 0.35rem;
    }
    @media (max-width: 720px) {
      .group-head,
      .link-row {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SettingsPage implements OnInit {
  private readonly dash = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);

  draft: DashboardDocument | null = null;
  accent = '#d9a441';
  searchEngine = 'https://duckduckgo.com/?q=%s';
  readonly dirty = signal(false);
  readonly error = signal<string | null>(null);
  readonly section = signal<SettingsSection>('general');

  readonly toColorInput = toColorInput;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const section = params.get('section');
      this.section.set(section === 'sidebar' ? 'sidebar' : 'general');
    });

    this.dash.load().subscribe({
      next: (doc) => {
        this.draft = structuredClone(doc);
        if (!this.draft.sidebar) this.draft.sidebar = { showInstalledApps: true, bookmarks: [] };
        if (!Array.isArray(this.draft.sidebar.bookmarks)) this.draft.sidebar.bookmarks = [];
        this.accent = doc.theme?.accent || '#d9a441';
        this.searchEngine = doc.search?.engine || 'https://duckduckgo.com/?q=%s';
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  markDirty(): void {
    this.dirty.set(true);
  }

  onAccent(value: string): void {
    if (!this.draft) return;
    this.draft.theme = { ...(this.draft.theme || {}), accent: value };
    this.markDirty();
  }

  onSearchEngine(value: string): void {
    if (!this.draft) return;
    this.draft.search = { ...(this.draft.search || {}), engine: value };
    this.markDirty();
  }

  onSearchPlaceholder(value: string): void {
    if (!this.draft) return;
    this.draft.search = { ...(this.draft.search || {}), placeholder: value };
    this.markDirty();
  }

  addGroup(): void {
    if (!this.draft?.sidebar) return;
    this.draft.sidebar.bookmarks = [
      ...(this.draft.sidebar.bookmarks || []),
      { title: 'New group', color: '#4caf8f', links: [] },
    ];
    this.draft = { ...this.draft };
    this.markDirty();
  }

  setGroupColor(gi: number, value: string): void {
    const group = this.draft?.sidebar?.bookmarks?.[gi];
    if (!group) return;
    group.color = value;
    this.markDirty();
  }

  moveGroup(gi: number, delta: number): void {
    const list = this.draft?.sidebar?.bookmarks;
    if (!list) return;
    const to = gi + delta;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(gi, 1);
    next.splice(to, 0, item);
    this.draft!.sidebar!.bookmarks = next;
    this.draft = { ...this.draft! };
    this.markDirty();
  }

  removeGroup(gi: number): void {
    const group = this.draft?.sidebar?.bookmarks?.[gi];
    if (!group) return;
    if (!confirm(`Delete group “${group.title || 'Untitled'}”?`)) return;
    this.draft!.sidebar!.bookmarks = this.draft!.sidebar!.bookmarks!.filter((_, i) => i !== gi);
    this.draft = { ...this.draft! };
    this.markDirty();
  }

  addLink(gi: number): void {
    const group = this.draft?.sidebar?.bookmarks?.[gi];
    if (!group) return;
    group.links = [...(group.links || []), { title: '', url: '', domain: '' }];
    this.draft = { ...this.draft! };
    this.markDirty();
  }

  removeLink(gi: number, li: number): void {
    const group = this.draft?.sidebar?.bookmarks?.[gi];
    if (!group) return;
    group.links = group.links.filter((_, i) => i !== li);
    this.draft = { ...this.draft! };
    this.markDirty();
  }

  onLinkUrl(gi: number, li: number, url: string): void {
    const link = this.draft?.sidebar?.bookmarks?.[gi]?.links?.[li];
    if (!link) return;
    link.url = url;
    try {
      link.domain = new URL(url).hostname;
    } catch {
      /* keep previous domain while typing */
    }
    this.markDirty();
  }

  save(): void {
    if (!this.draft) return;
    // Drop empty links/groups
    const bookmarks = (this.draft.sidebar?.bookmarks || [])
      .map((g) => ({
        ...g,
        links: (g.links || []).filter((l) => l.url?.trim()),
      }))
      .filter((g) => g.title?.trim() && g.links.length);
    this.draft.sidebar = { ...(this.draft.sidebar || {}), bookmarks };
    this.dash.save(this.draft).subscribe({
      next: () => {
        this.dirty.set(false);
        document.documentElement.style.setProperty('--accent', this.accent);
      },
      error: (err: Error) => alert(err.message),
    });
  }
}
