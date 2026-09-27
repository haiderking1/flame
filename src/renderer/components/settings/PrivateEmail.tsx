import { useState } from "react";
import "./private-email.css";

export function PrivateEmail({ email }: { email: string }) {
  const [revealed, setRevealed] = useState(false);
  return <button type="button" className="private-email" data-revealed={revealed}
    aria-label={revealed ? `Hide email address: ${email}` : "Reveal email address"}
    aria-pressed={revealed} title={revealed ? "Hide email address" : "Reveal email address"}
    onClick={() => setRevealed((value) => !value)}>
    <span aria-hidden="true">{email}</span>
  </button>;
}
