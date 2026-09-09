import { Component, EventEmitter, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BUILTIN_WIDGETS,
  CUSTOM_WIDGETS,
  WidgetDefinition,
  createPageItem,
} from './widget-catalog';
import { PageItem } from '../core/models/dashboard';

@Component({
  selector: 'app-add-widget-panel',
  imports: [FormsModule],
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <aside class="panel" role="dialog" aria-label="Add widget">
      <header class="panel-head">
        <h2>Add widget</h2>
        <button type="button" class="btn btn--sm" (click)="closed.emit()">Close</button>
      </header>

      <nav class="tabs">
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
                <strong>{{ def.label }}</strong>
                <span>{{ def.description }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <div class="custom">
          <label class="field">
            <span>Type</span>
            <select [ngModel]="customType()" (ngModelChange)="onCustomType($event)">
              @for (def of customs; track def.type) {
                <option [value]="def.type">{{ def.label }}</option>
              }
            </select>
          </label>
          <p class="hint">{{ customHint() }}</p>

          <label class="field">
            <span>Title</span>
            <input [(ngModel)]="customTitle" />
          </label>

          @if (customType() === 'iframe') {
            <label class="field">
              <span>URL</span>
              <input [(ngModel)]="customUrl" placeholder="https://" />
            </label>
          }
          @if (customType() === 'note') {
            <label class="field">
              <span>Text</span>
              <textarea rows="5" [(ngModel)]="customText"></textarea>
            </label>
          }
          @if (customType() === 'links') {
            <label class="field">
              <span>Links (one per line: Title | https://…)</span>
              <textarea
                rows="5"
                [(ngModel)]="customLinksText"
                placeholder="GitHub | https://github.com"
              ></textarea>
            </label>
          }

          <button type="button" class="btn btn--primary" (click)="addCustom()">Add custom widget</button>
        </div>
      }
    </aside>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 40;
    }
    .panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(380px, 100vw);
      z-index: 41;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--bg-elevated);
      border-left: 1px solid var(--border);
      box-shadow: -12px 0 40px rgba(0, 0, 0, 0.35);
      overflow: auto;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 1.05rem;
    }
    .tabs {
      display: flex;
      gap: 0.25rem;
    }
    .tab {
      flex: 1;
      padding: 0.4rem 0.6rem;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .tab.is-active {
      color: var(--accent);
      background: var(--accent-soft);
      border-color: var(--accent-border);
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
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.65rem 0.75rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }
    .catalog-item:hover {
      border-color: var(--accent-border);
      background: var(--widget-hover);
    }
    .catalog-item strong {
      font-size: 0.9rem;
    }
    .catalog-item span {
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .custom {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      font-size: 0.82rem;
      color: var(--text-dim);
      font-weight: 500;
    }
    .field input,
    .field select,
    .field textarea {
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      color: var(--text);
      font: inherit;
      font-weight: 400;
      padding: 0.5rem 0.65rem;
    }
    .field textarea {
      resize: vertical;
      min-height: 96px;
    }
    .hint {
      margin: 0;
      font-size: 0.8rem;
      color: var(--text-muted);
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
