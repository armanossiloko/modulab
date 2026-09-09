import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-placeholder-widget',
  template: `
    <p class="empty-note">{{ label }} widget — coming in a later pass.</p>
  `,
})
export class PlaceholderWidget {
  @Input() type = 'unknown';
  get label(): string {
    return this.type;
  }
}
