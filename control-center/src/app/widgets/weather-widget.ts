import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-weather-widget',
  template: `
    @if (error()) {
      <p class="empty-note">{{ error() }}</p>
    } @else if (loading()) {
      <p class="empty-note">Loading weather…</p>
    } @else {
      <div class="w-weather">
        <p class="w-weather__temp">{{ tempLabel() }}</p>
        <p class="w-weather__meta">{{ label() }} · {{ windLabel() }}</p>
      </div>
    }
  `,
  styles: `
    .w-weather {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 0.1rem;
    }
    .w-weather__temp {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.1;
    }
    .w-weather__meta {
      margin: 0;
      color: var(--text-dim);
      font-size: 0.75rem;
    }
  `,
})
export class WeatherWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};

  private readonly dash = inject(DashboardService);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tempLabel = signal('—');
  readonly windLabel = signal('');
  readonly label = signal('Local');

  ngOnInit(): void {
    const merged = { ...this.dash.widgetConfig('weather'), ...this.config };
    const lat = Number(merged['latitude'] ?? 52.52);
    const lon = Number(merged['longitude'] ?? 13.405);
    const label = String(merged['label'] ?? 'Local');
    this.label.set(label);
    this.dash.weather(lat, lon, label).subscribe({
      next: (data) => {
        this.loading.set(false);
        const temp = Number(data.temperatureC);
        const wind = Number(data.windKmh);
        this.tempLabel.set(Number.isFinite(temp) ? `${Math.round(temp)}°` : '—');
        this.windLabel.set(
          Number.isFinite(wind)
            ? `${Math.round(wind)} km/h${data.summary ? ` · ${data.summary}` : ''}`
            : data.summary || ''
        );
        if (data.label) this.label.set(data.label);
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message);
      },
    });
  }
}
