/** Shared compact-mode behaviour for the two-number stat widgets. */
export const STAT_WIDGET_STYLES = `
  .stat__value.is-positive {
    color: var(--positive);
  }
  @container widget (max-height: 84px) {
    .stats {
      gap: 0.85rem;
      justify-content: flex-end;
    }
    .stat {
      flex: 0 0 auto;
      flex-direction: row;
      align-items: baseline;
      gap: 0.35rem;
      padding: 0;
      border: none;
      background: none;
    }
    .stat__value {
      font-size: var(--fs-lg);
    }
  }
  @container widget (max-height: 84px) and (max-width: 230px) {
    .stats {
      justify-content: space-between;
      gap: 0.5rem;
    }
  }
`;
