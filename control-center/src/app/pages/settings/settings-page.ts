import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardDocument } from '../../core/models/dashboard';
import { Icon } from '../../shared/icon';

type SettingsSection = 'general' | 'sidebar' | 'lab';

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
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <section class="settings">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Settings</h1>
          <nav class="tabs" aria-label="Settings sections">
            <a routerLink="/settings" class="tab" [class.is-active]="section() === 'general'">General</a>
            <a routerLink="/settings/lab" class="tab" [class.is-active]="section() === 'lab'">Lab</a>
            <a routerLink="/settings/sidebar" class="tab" [class.is-active]="section() === 'sidebar'"
              >Shortcuts</a
            >
          </nav>
        </div>
        <div class="page-header__actions">
          <button type="button" class="btn btn--solid" [disabled]="!dirty()" (click)="save()">
            Save
          </button>
        </div>
      </header>

      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (section() === 'lab') {
        <div class="lab">
          <section class="section">
            <div class="section__head">
              <div>
                <h2 class="section__title">Network</h2>
                <p class="section__desc">
                  How this host is reached on the LAN. Set the host IP before installing apps.
                </p>
              </div>
            </div>

            @if (labSuggested() && labSuggested() !== labDraft.hostIp) {
              <p class="banner lab-suggest">
                This browser is on <strong>{{ labSuggested() }}</strong>
                <button type="button" class="btn btn--sm" (click)="useSuggested()">Use this IP</button>
              </p>
            }

            <div class="field-grid">
              <label class="field">
                <span class="field__label">Host IP</span>
                <input
                  class="input"
                  [(ngModel)]="labDraft.hostIp"
                  (ngModelChange)="markDirty()"
                  placeholder="192.168.1.50"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span class="field__hint">LAN address of this machine.</span>
              </label>
              <label class="field">
                <span class="field__label">Domain</span>
                <input
                  class="input"
                  [(ngModel)]="labDraft.domain"
                  (ngModelChange)="markDirty()"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span class="field__hint">Names look like home.{{ labDraft.domain || 'network.lan' }}.</span>
              </label>
              <label class="field">
                <span class="field__label">Timezone</span>
                <input
                  class="input"
                  [(ngModel)]="labDraft.timezone"
                  (ngModelChange)="markDirty()"
                  placeholder="Europe/Berlin"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
            </div>

            <div class="lab-switches">
              <label class="switch">
                <span class="switch__text">
                  LAN reverse proxy
                  <small>Publish app hostnames through Caddy on port 80.</small>
                </span>
                <input
                  type="checkbox"
                  [(ngModel)]="labDraft.enableLanProxy"
                  (ngModelChange)="markDirty()"
                />
              </label>
              <label class="switch">
                <span class="switch__text">
                  Pi-hole DNS
                  <small>Resolve those names for devices on the LAN.</small>
                </span>
                <input
                  type="checkbox"
                  [(ngModel)]="labDraft.enablePihole"
                  (ngModelChange)="markDirty()"
                />
              </label>
            </div>
          </section>

          <section class="section">
            <div class="section__head">
              <div>
                <h2 class="section__title">Postgres</h2>
                <p class="section__desc">
                  Shared database used by apps that need one. This does not migrate data that is
                  already stored.
                </p>
              </div>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field__label">User</span>
                <input
                  class="input"
                  [(ngModel)]="labDraft.postgresUser"
                  (ngModelChange)="markDirty()"
                  autocomplete="off"
                />
              </label>
              <label class="field">
                <span class="field__label">Password</span>
                <input
                  class="input"
                  type="password"
                  [(ngModel)]="labDraft.postgresPassword"
                  (ngModelChange)="markDirty()"
                  autocomplete="new-password"
                />
              </label>
              <label class="field">
                <span class="field__label">Database</span>
                <input
                  class="input"
                  [(ngModel)]="labDraft.postgresDb"
                  (ngModelChange)="markDirty()"
                  autocomplete="off"
                />
              </label>
            </div>
          </section>

          <section class="section">
            <div class="section__head">
              <div>
                <h2 class="section__title">Pi-hole</h2>
                <p class="section__desc">Password for the Pi-hole admin page.</p>
              </div>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field__label">Admin password</span>
                <input
                  class="input"
                  type="password"
                  [(ngModel)]="labDraft.piholePassword"
                  (ngModelChange)="markDirty()"
                  autocomplete="new-password"
                />
              </label>
            </div>
          </section>
        </div>
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
              <p class="lede">Drag a shortcut to reorder it, or drop it into another group.</p>
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

                <div
                  class="link-list"
                  [class.is-armed]="dragFrom() !== null"
                  (dragover)="onDragOverList($event, gi)"
                  (drop)="onDropList($event, gi)"
                >
                  @for (link of group.links; track link; let li = $index) {
                    <div
                      class="link-row"
                      [class.is-dragging]="dragFrom()?.gi === gi && dragFrom()?.li === li"
                      [class.is-drop-before]="dropAt()?.gi === gi && dropAt()?.li === li"
                      (dragover)="onDragOverRow($event, gi, li)"
                      (drop)="onDropRow($event, gi, li)"
                    >
                      <span
                        class="link-grip"
                        draggable="true"
                        role="button"
                        tabindex="0"
                        title="Drag shortcut"
                        aria-label="Drag shortcut"
                        (dragstart)="onDragStart($event, gi, li)"
                        (dragend)="onDragEnd()"
                      >
                        <app-icon name="grip" [size]="14" [stroke]="2.4" />
                      </span>
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
                  <div
                    class="link-drop-tail"
                    [class.is-active]="
                      dropAt()?.gi === gi && dropAt()?.li === group.links.length
                    "
                    (dragover)="onDragOverList($event, gi)"
                    (drop)="onDropList($event, gi)"
                  ></div>
                </div>

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
    .page-header {
      margin-bottom: var(--space-4);
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
    .link-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-height: 0.5rem;
    }
    .link-row {
      display: grid;
      grid-template-columns: auto minmax(100px, 160px) minmax(0, 1fr) auto;
      gap: 0.4rem;
      align-items: center;
      border-radius: var(--radius-sm);
    }
    .link-row.is-dragging {
      opacity: 0.4;
    }
    .link-row.is-drop-before {
      box-shadow: inset 0 2px 0 var(--accent);
    }
    .link-grip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: var(--control-h);
      color: var(--text-muted);
      cursor: grab;
      border-radius: var(--radius-sm);
    }
    .link-grip:hover {
      color: var(--text);
      background: var(--inset);
    }
    .link-grip:active {
      cursor: grabbing;
    }
    .link-drop-tail {
      height: 0;
      border-radius: var(--radius-sm);
    }
    .link-list.is-armed .link-drop-tail {
      height: 1.75rem;
      border: 1px dashed var(--border);
    }
    .link-drop-tail.is-active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .add-link {
      margin-top: 0.35rem;
    }
    .lab {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      max-width: 880px;
    }
    .lab-suggest {
      margin: 0 0 var(--space-4);
    }
    .lab-suggest strong {
      font-weight: 650;
    }
    .lab-switches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    @media (max-width: 720px) {
      .group-head {
        grid-template-columns: 1fr;
      }
      .link-row {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }
      .link-url {
        grid-column: 2;
      }
    }
  `,
})
export class SettingsPage implements OnInit {
  private readonly dash = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  draft: DashboardDocument | null = null;
  labDraft = {
    hostIp: '',
    domain: 'network.lan',
    timezone: 'UTC',
    postgresUser: 'modulab',
    postgresPassword: 'modulab',
    postgresDb: 'modulab',
    piholePassword: 'modulab',
    enableLanProxy: true,
    enablePihole: false,
  };
  accent = '#d9a441';
  searchEngine = 'https://duckduckgo.com/?q=%s';
  readonly dirty = signal(false);
  readonly error = signal<string | null>(null);
  readonly section = signal<SettingsSection>('general');
  readonly labSuggested = signal<string | null>(null);
  readonly dragFrom = signal<{ gi: number; li: number } | null>(null);
  readonly dropAt = signal<{ gi: number; li: number } | null>(null);

  readonly toColorInput = toColorInput;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const section = params.get('section');
      if (section === 'sidebar') this.section.set('sidebar');
      else if (section === 'lab') this.section.set('lab');
      else this.section.set('general');
    });

    this.dash.load().subscribe({
      next: (doc) => {
        this.draft = structuredClone(doc);
        if (!this.draft.sidebar) this.draft.sidebar = { showInstalledApps: true, bookmarks: [] };
        if (!Array.isArray(this.draft.sidebar.bookmarks)) this.draft.sidebar.bookmarks = [];
        this.accent = doc.theme?.accent || '#d9a441';
        this.searchEngine = doc.search?.engine || 'https://duckduckgo.com/?q=%s';
        this.cdr.markForCheck();
      },
      error: (err: Error) => this.error.set(err.message),
    });

    this.dash.getLabSettings().subscribe({
      next: (s) => {
        this.labDraft = {
          hostIp: s.hostIp ?? '',
          domain: s.domain ?? 'network.lan',
          timezone: s.timezone ?? 'UTC',
          postgresUser: s.postgresUser ?? 'modulab',
          postgresPassword: s.postgresPassword ?? 'modulab',
          postgresDb: s.postgresDb ?? 'modulab',
          piholePassword: s.piholePassword ?? 'modulab',
          enableLanProxy: s.enableLanProxy ?? true,
          enablePihole: s.enablePihole ?? false,
        };
        this.cdr.markForCheck();
      },
      error: () => {
        /* Lab settings optional if API older */
      },
    });
    this.dash.loadLabStatus().subscribe({
      next: (st) => this.labSuggested.set(st.suggestedHostIp ?? null),
      error: () => undefined,
    });
  }

  markDirty(): void {
    this.dirty.set(true);
  }

  useSuggested(): void {
    const ip = this.labSuggested();
    if (!ip) return;
    this.labDraft.hostIp = ip;
    this.markDirty();
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

  onDragStart(event: DragEvent, gi: number, li: number): void {
    const row = (event.currentTarget as HTMLElement | null)?.closest('.link-row');
    if (row && event.dataTransfer) {
      const rect = row.getBoundingClientRect();
      event.dataTransfer.setDragImage(row, 20, rect.height / 2);
    }
    event.dataTransfer?.setData('text/plain', `${gi}:${li}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dragFrom.set({ gi, li });
    this.dropAt.set(null);
  }

  onDragEnd(): void {
    this.dragFrom.set(null);
    this.dropAt.set(null);
  }

  onDragOverRow(event: DragEvent, gi: number, li: number): void {
    if (!this.dragFrom()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const row = event.currentTarget as HTMLElement;
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    this.aim(gi, li + (after ? 1 : 0));
  }

  onDropRow(event: DragEvent, gi: number, li: number): void {
    if (!this.dragFrom()) return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.currentTarget as HTMLElement;
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    this.moveLink(gi, li + (after ? 1 : 0));
  }

  onDragOverList(event: DragEvent, gi: number): void {
    if (!this.dragFrom()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const len = this.draft?.sidebar?.bookmarks?.[gi]?.links?.length ?? 0;
    this.aim(gi, len);
  }

  onDropList(event: DragEvent, gi: number): void {
    if (!this.dragFrom()) return;
    event.preventDefault();
    const len = this.draft?.sidebar?.bookmarks?.[gi]?.links?.length ?? 0;
    this.moveLink(gi, len);
  }

  private aim(gi: number, li: number): void {
    const cur = this.dropAt();
    if (cur?.gi === gi && cur.li === li) return;
    this.dropAt.set({ gi, li });
  }

  private moveLink(toGi: number, toLi: number): void {
    const from = this.dragFrom();
    const groups = this.draft?.sidebar?.bookmarks;
    this.onDragEnd();
    if (!from || !groups) return;
    const source = groups[from.gi];
    const target = groups[toGi];
    if (!source?.links || !target) return;
    if (from.gi === toGi && (from.li === toLi || from.li + 1 === toLi)) return;

    const src = [...source.links];
    const [item] = src.splice(from.li, 1);
    if (!item) return;
    let insertAt = toLi;
    if (from.gi === toGi && from.li < toLi) insertAt -= 1;
    if (from.gi === toGi) {
      src.splice(insertAt, 0, item);
      source.links = src;
    } else {
      source.links = src;
      const dest = [...(target.links || [])];
      dest.splice(toLi, 0, item);
      target.links = dest;
    }
    this.draft = { ...this.draft! };
    this.markDirty();
    this.cdr.markForCheck();
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
    if (this.section() === 'lab') {
      this.dash
        .saveLabSettings({
          hostIp: this.labDraft.hostIp,
          domain: this.labDraft.domain,
          timezone: this.labDraft.timezone,
          postgresUser: this.labDraft.postgresUser,
          postgresPassword: this.labDraft.postgresPassword,
          postgresDb: this.labDraft.postgresDb,
          piholePassword: this.labDraft.piholePassword,
          enableLanProxy: this.labDraft.enableLanProxy,
          enablePihole: this.labDraft.enablePihole,
        })
        .subscribe({
          next: () => this.dirty.set(false),
          error: (err: Error) => alert(err.message),
        });
      return;
    }
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
