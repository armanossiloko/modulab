import { Component, Input, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-year-progress-widget',
  imports: [DecimalPipe],
  template: `
    <div class="yp">
      <div class="yp__bar" role="progressbar" [attr.aria-valuenow]="pct()">
        <span class="yp__fill" [style.width.%]="pct()"></span>
      </div>
      <p class="yp__label">{{ pct() | number: '1.1-1' }}% of {{ year }}</p>
    </div>
  `,
  styles: `
    .yp {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .yp__bar {
      height: 6px;
      border-radius: 999px;
      background: var(--inset);
      box-shadow: inset 0 0 0 1px var(--border-soft);
      overflow: hidden;
    }
    .yp__fill {
      display: block;
      height: 100%;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--accent) 55%, transparent),
        var(--accent)
      );
      border-radius: inherit;
      box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
      transition: width 0.4s var(--ease);
    }
    .yp__label {
      margin: 0;
      font-family: var(--mono);
      font-size: var(--fs-xs);
      color: var(--text-dim);
      white-space: nowrap;
    }
    @container widget (max-height: 84px) {
      .yp {
        flex-direction: row;
        align-items: center;
        gap: 0.6rem;
        width: 100%;
      }
      .yp__bar {
        flex: 1;
        min-width: 24px;
      }
    }
  `,
})
export class YearProgressWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  readonly pct = signal(0);
  year = new Date().getFullYear();

  ngOnInit(): void {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
    this.pct.set(((now.getTime() - start) / (end - start)) * 100);
  }
}
