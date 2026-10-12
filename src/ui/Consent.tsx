import { useEffect, useRef } from 'react';

export function ConsentModal({ onAccept, onCancel, audio }: { onAccept: () => void; onCancel: () => void; audio?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div className="modal-bg" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-h">
        <h2 id="consent-h">{audio ? 'Before you record voice' : 'Before you record'}</h2>
        {audio && (
          <ul>
            <li>Audio is listened to <b>only in this browser</b> by a small speech model. The audio itself is <b>never stored</b>, only the text.</li>
            <li>The microphone and shared-tab audio are used only while the red recording indicator is on. Pausing mutes both.</li>
            <li>Transcripts are scrubbed with the same rules as the screen (cards, emails, phone numbers, secrets) before they are saved.</li>
            <li>Tell people in the room or on the call. Recording other people may need their consent where you live.</li>
          </ul>
        )}
        {!audio && <ul>
          <li>Flatpak takes a snapshot of the screen you choose about every 3 seconds.</li>
          <li>Everything is processed and stored <b>only in this browser</b> (private, on your device). Nothing is uploaded.</li>
          <li>Card numbers, emails, phone numbers and secrets are blurred <b>before</b> a frame is saved. The original is discarded.</li>
          <li>A recording indicator stays visible in the page and tab title. Pause any time with Alt+Shift+P.</li>
        </ul>}
        {!audio && <p className="muted">Passwords inside a screen share can still appear if they are visible and not labelled. Share a single window when you can.</p>}
        <div className="row">
          <button ref={ref} className="btn primary" onClick={onAccept}>I understand, choose a screen</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
