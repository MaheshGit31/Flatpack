/// Hidden experimental flags. Voice memory is OFF and invisible unless you open the app once with ?exp=audio (remembered in this browser).
/// Open with ?exp=off to clear. The product is image-centric: screen frames are the whole index.
const KEY = 'flatpak-exp';
function read(): string[] {
  try {
    const q = new URLSearchParams(location.search).get('exp');
    if (q === 'off') localStorage.removeItem(KEY);
    else if (q) localStorage.setItem(KEY, q);
    return (localStorage.getItem(KEY) ?? '').split(',').filter(Boolean);
  } catch { return []; }
}
const flags = read();
export const experimentalAudio = (): boolean => flags.includes('audio');
