import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-clock-widget',
  imports: [DatePipe],
  template: `
    <div class="w-clock">
      <p class="w-clock__time">{{ now | date: 'HH:mm' }}</p>
      <p class="w-clock__date">{{ now | date: 'EEEE, d MMM' }}</p>
    </div>
  `,
  styles: `
    .w-clock {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 0.1rem;
    }
    .w-clock__time {
      margin: 0;
      font-family: var(--mono);
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--text);
      line-height: 1.1;
    }
    .w-clock__date {
      margin: 0;
      color: var(--text-dim);
      font-size: 0.75rem;
    }
  `,
})
export class ClockWidget implements OnInit, OnDestroy {
  @Input() config: Record<string, unknown> = {};
  now = new Date();
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.timer = setInterval(() => {
      this.now = new Date();
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
