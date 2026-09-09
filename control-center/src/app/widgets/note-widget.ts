import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-note-widget',
  template: `
    @if (!text) {
      <p class="empty-note">Empty note — add text when creating the widget.</p>
    } @else {
      <pre class="note">{{ text }}</pre>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow: auto;
    }
    .note {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--font);
      font-size: 0.9rem;
      line-height: 1.45;
      color: var(--text);
    }
  `,
})
export class NoteWidget {
  text = '';

  @Input() set config(value: Record<string, unknown>) {
    this.text = String(value?.['text'] ?? '');
  }
}
