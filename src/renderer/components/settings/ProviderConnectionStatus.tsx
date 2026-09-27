import "./provider-connection-status.css";

export function ProviderConnectionStatus({ connected }: { connected: boolean }) {
  const label = connected ? "Connected" : "Not connected";
  return <span className="provider-connection-status" data-connected={connected} role="img" aria-label={label} title={label} />;
}
