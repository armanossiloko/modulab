import { Component, Input, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-calendar-widget',
  template: `
    <div class="cal">
      <p class="cal-month">{{ monthLabel() }}</p>
      <div class="cal-grid">
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
      gap: 0.4rem;
    }
    .cal-month {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-dim);
    }
    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.15rem;
      flex: 1;
    }
    .cal-day {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--mono);
      font-size: 0.68rem;
      color: var(--text);
      border-radius: 4px;
    }
    .cal-day.is-muted {
      color: var(--text-muted);
      opacity: 0.55;
    }
    .cal-day.is-today {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
  `,
})
export class CalendarWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  readonly monthLabel = signal('');
  readonly days = signal<{ label: string; inMonth: boolean; today: boolean }[]>([]);

  ngOnInit(): void {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    this.monthLabel.set(
      now.toLocaleString(undefined, { month: 'long', year: 'numeric' })
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
