import { Component, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DashboardService } from '../core/services/dashboard.service';

/** Clock and weather in one card — the two one-liners don't each need a tile. */
@Component({
  selector: 'app-now-widget',
  imports: [DatePipe],
  template: `
    <div class="now">
      <div class="now-clock">
        <p class="now-time">{{ now | date: 'HH:mm' }}</p>
        <p class="now-sub">{{ now | date: 'EEE, d MMM' }}</p>
      </div>
      <div class="now-weather">
        @if (error()) {
          <p class="now-sub">{{ error() }}</p>
        } @else if (loading()) {
          <p class="now-sub">Weather…</p>
        } @else {
          <p class="now-time">{{ tempLabel() }}</p>
          <p class="now-sub">{{ weatherMeta() }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      height: 100%;
      min-height: 0;
    }
    .now {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      min-width: 0;
    }
    .now-clock,
    .now-weather {
      min-width: 0;
    }
    .now-weather {
      text-align: right;
    }
    .now-time {
      margin: 0;
      font-family: var(--mono);
      font-size: 1.45rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .now-sub {
      margin: 0.2rem 0 0;
      color: var(--text-dim);
      font-size: var(--fs-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class NowWidget implements OnInit, OnDestroy {
  @Input() config: Record<string, unknown> = {};

  private readonly dash = inject(DashboardService);
  now = new Date();
  private timer?: ReturnType<typeof setInterval>;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tempLabel = signal('—');
  readonly weatherMeta = signal('');
  readonly label = signal('Local');

  ngOnInit(): void {
    this.timer = setInterval(() => {
      this.now = new Date();
    }, 1000);

    const merged = { ...this.dash.widgetConfig('weather'), ...this.config };
    const lat = Number(merged['latitude'] ?? 52.52);
    const lon = Number(merged['longitude'] ?? 13.405);
    this.label.set(String(merged['label'] ?? 'Local'));
    this.dash.weather(lat, lon, this.label()).subscribe({
      next: (data) => {
        this.loading.set(false);
        const temp = Number(data.temperatureC);
        const wind = Number(data.windKmh);
        this.tempLabel.set(Number.isFinite(temp) ? `${Math.round(temp)}°` : '—');
        if (data.label) this.label.set(data.label);
        const detail = data.summary || (Number.isFinite(wind) ? `${Math.round(wind)} km/h` : '');
        this.weatherMeta.set(detail ? `${this.label()} · ${detail}` : this.label());
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
