import "./composer-settings.css";

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ComposerSettings() {
  return (
    <div className="composer-settings" role="group" aria-label="Model settings">
      <button
        className="composer-settings__control composer-settings__model"
        type="button"
        disabled
        aria-label="Select model"
        title="Model selection will be available when an agent is connected"
      >
        <svg className="composer-settings__icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m10 2 7 4v8l-7 4-7-4V6l7-4Z M3 6l7 4 7-4 M10 10v8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="composer-settings__label">Select model</span>
        <Chevron />
      </button>
      <span className="composer-settings__divider" aria-hidden="true" />
      <button
        className="composer-settings__control"
        type="button"
        disabled
        aria-label="Thinking level: Medium"
        title="Thinking levels will depend on the selected model"
      >
        <span>Medium</span>
        <Chevron />
      </button>
    </div>
  );
}
