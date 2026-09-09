import { Component, Input } from '@angular/core';
import { ClockWidget } from './clock-widget';
import { WeatherWidget } from './weather-widget';
import { StacksWidget } from './stacks-widget';
import { YearProgressWidget } from './year-progress-widget';
import { FeedWidget } from './feed-widget';
import { PlaceholderWidget } from './placeholder-widget';
import { IframeWidget } from './iframe-widget';
import { NoteWidget } from './note-widget';
import { LinksWidget } from './links-widget';
import { StackUsageWidget } from './stack-usage-widget';
import { NetworkWidget } from './network-widget';
import { NowRunningWidget } from './now-running-widget';
import { CalendarWidget } from './calendar-widget';
import { UpdatesWidget } from './updates-widget';

@Component({
  selector: 'app-widget-host',
  imports: [
    ClockWidget,
    WeatherWidget,
    StacksWidget,
    YearProgressWidget,
    FeedWidget,
    PlaceholderWidget,
    IframeWidget,
    NoteWidget,
    LinksWidget,
    StackUsageWidget,
    NetworkWidget,
    NowRunningWidget,
    CalendarWidget,
    UpdatesWidget,
  ],
  template: `
    <header class="widget-head">
      <h3 class="widget-title">{{ title }}</h3>
      <ng-content select="[widgetActions]" />
    </header>
    <div class="widget-body">
      @switch (type) {
        @case ('clock') {
          <app-clock-widget [config]="config" />
        }
        @case ('weather') {
          <app-weather-widget [config]="config" />
        }
        @case ('stacks') {
          <app-stacks-widget class="fills" [config]="config" />
        }
        @case ('updates') {
          <app-updates-widget class="fills" [config]="config" />
        }
        @case ('yearProgress') {
          <app-year-progress-widget [config]="config" />
        }
        @case ('hackerNews') {
          <app-feed-widget class="fills" kind="hn" [config]="config" />
        }
        @case ('community') {
          <app-feed-widget class="fills" kind="reddit" [config]="config" />
        }
        @case ('iframe') {
          <app-iframe-widget class="fills" [config]="config" />
        }
        @case ('note') {
          <app-note-widget class="fills" [config]="config" />
        }
        @case ('links') {
          <app-links-widget class="fills" [config]="config" />
        }
        @case ('stackUsage') {
          <app-stack-usage-widget [config]="config" />
        }
        @case ('network') {
          <app-network-widget [config]="config" />
        }
        @case ('nowRunning') {
          <app-now-running-widget [config]="config" />
        }
        @case ('calendar') {
          <app-calendar-widget class="fills" [config]="config" />
        }
        @case ('media') {
          <p class="empty-note">Install Jellyfin, Immich, or Seerr from the Library.</p>
        }
        @default {
          <app-placeholder-widget [type]="type" />
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .widget-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex: 0 0 auto;
      margin-bottom: 0.2rem;
    }
    .widget-title {
      margin: 0;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .widget-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }
    /* Don't stretch compact widgets — that creates empty dead space. */
    .widget-body > * {
      flex: 0 0 auto;
      min-height: 0;
    }
    .widget-body > .fills {
      flex: 1 1 auto;
    }
  `,
})
export class WidgetHost {
  @Input({ required: true }) type!: string;
  @Input() title = '';
  @Input() config: Record<string, unknown> = {};
}
