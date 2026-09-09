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
      justify-content: flex-start;
      gap: 0.35rem;
    }
    .yp__bar {
      height: 6px;
      border-radius: 999px;
      background: hsl(240, 8%, 18%);
      overflow: hidden;
    }
    .yp__fill {
      display: block;
      height: 100%;
      background: var(--accent);
      border-radius: inherit;
      transition: width 0.4s ease;
    }
    .yp__label {
      margin: 0;
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--text-dim);
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
