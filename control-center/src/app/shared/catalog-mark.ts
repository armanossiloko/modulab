import { Component, Input, signal } from '@angular/core';

/** Recipe ids that have a bundled logo in public/app-icons. */
const APP_LOGOS = new Set([
  'bentopdf',
  'caddy',
  'futo-notes',
  'immich',
  'it-tools',
  'jellyfin',
  'mediacms',
  'n8n',
  'picoshare',
  'pihole',
  'postgres',
  'redis',
  'searxng',
  'seerr',
  'stirling-pdf',
]);

@Component({
  selector: 'app-catalog-mark',
  host: {
    '[style.--mark.px]': 'size',
  },
  template: `
    @if (src && !failed()) {
      <img
        class="mark"
        [src]="src"
        alt=""
        [width]="size"
        [height]="size"
        (error)="failed.set(true)"
      />
    } @else {
      <span class="mark mark--letter" [style.--cat]="color" aria-hidden="true">{{
        name.charAt(0)
      }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-grid;
      flex: 0 0 auto;
      line-height: 0;
    }
    .mark {
      width: var(--mark, 36px);
      height: var(--mark, 36px);
      border-radius: calc(var(--mark, 36px) * 0.28);
      object-fit: contain;
      background: var(--inset);
      border: 1px solid var(--border-soft);
      padding: calc(var(--mark, 36px) * 0.1);
    }
    .mark--letter {
      display: inline-grid;
      place-items: center;
      padding: 0;
      background: color-mix(in srgb, var(--cat, var(--cat-other)) 16%, var(--inset));
      border-color: color-mix(in srgb, var(--cat, var(--cat-other)) 30%, transparent);
      color: var(--cat, var(--cat-other));
      font-weight: 700;
      font-size: calc(var(--mark, 36px) * 0.46);
      line-height: 1;
      text-transform: uppercase;
    }
  `,
})
export class CatalogMark {
  @Input({ required: true }) id!: string;
  @Input({ required: true }) name!: string;
  @Input() color = 'var(--cat-other)';
  @Input() size = 36;

  readonly failed = signal(false);

  get src(): string | null {
    return APP_LOGOS.has(this.id) ? `app-icons/${this.id}.png` : null;
  }
}
