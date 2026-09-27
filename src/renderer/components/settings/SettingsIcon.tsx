export function SettingsIcon({ providers = false }: { providers?: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {providers ? <><rect x="4" y="7" width="16" height="14" rx="2" /><path d="M12 3v4M1 13h3m16 0h3M9 12v4m6-4v4" /></> : <><path d="m9 3-.7 2.3-2 .9-2.2-.5-2 3.5 1.5 1.8v2l-1.5 1.8 2 3.5 2.2-.5 2 .9L9 21h6l.7-2.3 2-.9 2.2.5 2-3.5-1.5-1.8v-2l1.5-1.8-2-3.5-2.2.5-2-.9L15 3Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}
