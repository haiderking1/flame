import { CHATGPT_USAGE_URL } from "@contracts/usage";
import openaiLogo from "../../../assets/providers/openai.svg?no-inline";

/** Signed in with ChatGPT: only ChatGPT shows the plan's usage and the limit set for Flame. */
export function ChatGPTPlanUsage() {
  return <article className="usage-card" aria-labelledby="usage-chatgpt-heading">
    <header className="usage-card__header"><span className="usage-card__logo"><img src={openaiLogo} alt="" /></span><h2 id="usage-chatgpt-heading">ChatGPT plan</h2>
      <button type="button" onClick={() => { window.open(CHATGPT_USAGE_URL, "_blank", "noopener"); }}>Manage usage</button>
    </header>
    <div className="usage-card__section">
      <h3>Plan usage</h3>
      <p>Flame uses your ChatGPT plan. ChatGPT shows how much of it Flame has used, and lets you limit how much Flame may use.</p>
    </div>
  </article>;
}
