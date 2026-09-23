import { Component, EventEmitter, HostListener, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BUILTIN_WIDGETS,
  CUSTOM_WIDGETS,
  WidgetDefinition,
  createPageItem,
} from './widget-catalog';
import { PageItem } from '../core/models/dashboard';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-add-widget-panel',
  imports: [FormsModule, Icon],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="add-widget-title">
      <header class="overlay-head">
        <h2 id="add-widget-title" class="overlay-title">Add widget</h2>
        <button
          type="button"
          class="icon-btn icon-btn--ghost"
          title="Close"
          aria-label="Close"
          (click)="closed.emit()"
        >
          <app-icon name="close" />
        </button>
      </header>

      <div class="overlay-body">
        <nav class="tabs tabs--block" aria-label="Widget kind">
          <button
            type="button"
            class="tab"
            [class.is-active]="tab() === 'builtin'"
            (click)="tab.set('builtin')"
          >
            Built-in
          </button>
          <button
            type="button"
            class="tab"
            [class.is-active]="tab() === 'custom'"
            (click)="tab.set('custom')"
          >
            Custom
          </button>
        </nav>

        @if (tab() === 'builtin') {
          <ul class="catalog">
            @for (def of builtins; track def.type) {
              <li>
                <button type="button" class="catalog-item" (click)="pickBuiltin(def)">
                  <span class="catalog-text">
                    <strong>{{ def.label }}</strong>
                    <span>{{ def.description }}</span>
                  </span>
                  <span class="catalog-add" aria-hidden="true">
                    <app-icon name="plus" [size]="14" />
                  </span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <div class="custom">
            <label class="field">
              <span class="field__label">Type</span>
              <select
                class="select"
                [ngModel]="customType()"
                (ngModelChange)="onCustomType($event)"
              >
                @for (def of customs; track def.type) {
                  <option [value]="def.type">{{ def.label }}</option>
                }
              </select>
              <p class="field__hint">{{ customHint() }}</p>
            </label>

            <label class="field">
              <span class="field__label">Title</span>
              <input class="input" [(ngModel)]="customTitle" />
            </label>

            @if (customType() === 'iframe') {
              <label class="field">
                <span class="field__label">URL</span>
                <input class="input" [(ngModel)]="customUrl" placeholder="https://" />
              </label>
            }
            @if (customType() === 'note') {
              <label class="field">
                <span class="field__label">Text</span>
                <textarea class="textarea" rows="5" [(ngModel)]="customText"></textarea>
              </label>
            }
            @if (customType() === 'links') {
              <label class="field">
                <span class="field__label">Links <em>— one per line: Title | https://…</em></span>
                <textarea
                  class="textarea"
                  rows="5"
                  [(ngModel)]="customLinksText"
                  placeholder="GitHub | https://github.com"
                ></textarea>
              </label>
            }
          </div>
        }
      </div>

      @if (tab() === 'custom') {
        <footer class="overlay-foot">
          <button type="button" class="btn btn--lg" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn btn--solid btn--lg" (click)="addCustom()">
            Add custom widget
          </button>
        </footer>
      }
    </aside>
  `,
  styles: `
    .tabs {
      margin-bottom: var(--space-3);
    }
    .catalog {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .catalog-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.65rem 0.75rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-soft);
      background: var(--widget);
      box-shadow: var(--highlight);
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .catalog-item:hover {
      border-color: var(--accent-border);
      background: var(--widget-hover);
    }
    .catalog-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }
    .catalog-text strong {
      font-size: var(--fs-md);
      font-weight: 600;
    }
    .catalog-text span {
      font-size: var(--fs-sm);
      color: var(--text-muted);
    }
    .catalog-add {
      display: inline-grid;
      place-items: center;
      width: var(--control-h-xs);
      height: var(--control-h-xs);
      border-radius: var(--radius-xs);
      color: var(--text-muted);
      transition:
        color 0.15s,
        background 0.15s;
    }
    .catalog-item:hover .catalog-add {
      color: var(--accent);
      background: var(--accent-soft);
    }
    .custom {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
  `,
})
export class AddWidgetPanel {
  @Output() readonly added = new EventEmitter<PageItem>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly builtins = BUILTIN_WIDGETS;
  readonly customs = CUSTOM_WIDGETS;
  readonly tab = signal<'builtin' | 'custom'>('builtin');
  readonly customType = signal('iframe');

  customTitle = 'Embed';
  customUrl = '';
  customText = '';
  customLinksText = 'Example | https://example.com';

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  customHint(): string {
    return this.customs.find((c) => c.type === this.customType())?.description ?? '';
  }

  onCustomType(type: string): void {
    this.customType.set(type);
    const def = this.customs.find((c) => c.type === type);
    this.customTitle = String(def?.defaultConfig?.['title'] ?? def?.label ?? 'Custom');
  }

  pickBuiltin(def: WidgetDefinition): void {
    this.added.emit(createPageItem(def.type));
  }

  addCustom(): void {
    const type = this.customType();
    const config: Record<string, unknown> = { title: this.customTitle.trim() || 'Custom' };

    if (type === 'iframe') {
      const url = this.customUrl.trim();
      if (!url) {
        alert('Enter a URL for the embed.');
        return;
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('bad protocol');
        }
      } catch {
        alert('Enter a valid http(s) URL.');
        return;
      }
      config['url'] = url;
    } else if (type === 'note') {
      config['text'] = this.customText;
    } else if (type === 'links') {
      config['links'] = this.customLinksText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, url] = line.includes('|')
            ? line.split('|').map((s) => s.trim())
            : [line, line];
          return { title: title || url, url };
        })
        .filter((l) => l.url);
      if (!(config['links'] as unknown[]).length) {
        alert('Add at least one link (Title | https://…).');
        return;
      }
    }

    this.added.emit(createPageItem(type, { config }));
  }
}
