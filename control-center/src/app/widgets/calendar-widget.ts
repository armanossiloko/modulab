import { Component, Input, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-calendar-widget',
  template: `
    <div class="cal">
      <p class="cal-month">{{ monthLabel() }}</p>
      <div class="cal-grid">
        @for (w of weekdays(); track $index) {
          <span class="cal-weekday">{{ w }}</span>
        }
        @for (d of days(); track $index) {
          <span class="cal-day" [class.is-today]="d.today" [class.is-muted]="!d.inMonth">{{
            d.label
          }}</span>
        }
      </div>
    </div>
  `,
  styles: `
    .cal {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.5rem;
    }
    .cal-month {
      margin: 0;
      font-size: var(--fs-md);
      font-weight: 650;
      color: var(--text);
    }
    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-auto-rows: 1fr;
      gap: 2px;
      flex: 1;
      min-height: 0;
    }
    .cal-weekday {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .cal-day {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--text-dim);
      border-radius: var(--radius-xs);
    }
    .cal-day.is-muted {
      color: var(--text-muted);
      opacity: 0.55;
    }
    .cal-day.is-today {
      background: var(--accent);
      color: var(--on-accent);
      font-weight: 600;
      box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
    }
  `,
})
export class CalendarWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  readonly monthLabel = signal('');
  readonly weekdays = signal<string[]>([]);
  readonly days = signal<{ label: string; inMonth: boolean; today: boolean }[]>([]);

  ngOnInit(): void {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    this.monthLabel.set(
      now.toLocaleString(undefined, { month: 'long', year: 'numeric' })
    );

    // 2023-01-01 was a Sunday; matches the getDay() offset below.
    this.weekdays.set(
      Array.from({ length: 7 }, (_, i) =>
        new Date(2023, 0, 1 + i).toLocaleString(undefined, { weekday: 'narrow' })
      )
    );

    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { label: string; inMonth: boolean; today: boolean }[] = [];

    for (let i = 0; i < startPad; i++) {
      cells.push({ label: '', inMonth: false, today: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        label: String(d),
        inMonth: true,
        today: d === now.getDate(),
      });
    }
    this.days.set(cells);
  }
}
