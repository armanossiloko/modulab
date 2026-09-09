import { Component, Input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-iframe-widget',
  template: `
    @if (!safeUrl) {
      <p class="empty-note">Set a URL in Edit layout → widget settings, or re-add this embed.</p>
    } @else {
      <iframe class="frame" [src]="safeUrl" title="Embedded content" loading="lazy"></iframe>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .frame {
      width: 100%;
      height: 100%;
      min-height: 120px;
      border: 0;
      border-radius: 8px;
      background: var(--bg);
    }
  `,
})
export class IframeWidget {
  @Input() set config(value: Record<string, unknown>) {
    const url = String(value?.['url'] ?? '').trim();
    this.safeUrl = url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  safeUrl: SafeResourceUrl | null = null;

  constructor(private readonly sanitizer: DomSanitizer) {}
}
