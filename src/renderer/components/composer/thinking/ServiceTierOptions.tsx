import type { ServiceTier } from "@contracts/models";

export function ServiceTierOptions({ value, supportsFast, busy, onSelect }: {
  value: ServiceTier; supportsFast: boolean; busy: boolean; onSelect(value: ServiceTier): void;
}) {
  return <div role="group" aria-label="Service Tier" className="thinking-picker__tiers">
    <h3 className="thinking-picker__heading">Service Tier</h3>
    <button type="button" role="menuitemradio" aria-checked={value === "default"} aria-disabled={busy}
      className="thinking-picker__option" onClick={() => { if (!busy) onSelect("default"); }}>
      <span>Standard</span><small className="thinking-picker__default">Default</small>
    </button>
    <button type="button" role="menuitemradio" aria-checked={value === "priority"} aria-disabled={busy || !supportsFast}
      className="thinking-picker__option thinking-picker__fast" onClick={() => { if (!busy && supportsFast) onSelect("priority"); }}>
      <span>Fast<small className="thinking-picker__tier-description">{supportsFast ? "Faster responses, increased usage" : "Unavailable for this model"}</small></span>
    </button>
  </div>;
}
