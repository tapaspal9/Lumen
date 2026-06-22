/* Lumen — Tweaks (visual directions). Mounts its own React root; writes CSS
 * variables that the vanilla app's stylesheet already consumes. */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "Azure",
  "tone": "Charcoal",
  "density": "Comfortable"
}/*EDITMODE-END*/;

const ACCENTS = {
  Azure:  { '--accent': 'oklch(0.74 0.13 232)', '--accent-soft': 'oklch(0.74 0.13 232 / 0.16)', '--accent-text': 'oklch(0.82 0.11 232)' },
  Teal:   { '--accent': 'oklch(0.76 0.115 195)', '--accent-soft': 'oklch(0.76 0.115 195 / 0.16)', '--accent-text': 'oklch(0.84 0.10 195)' },
  Amber:  { '--accent': 'oklch(0.80 0.115 75)', '--accent-soft': 'oklch(0.80 0.115 75 / 0.16)', '--accent-text': 'oklch(0.87 0.10 78)' },
  Violet: { '--accent': 'oklch(0.72 0.14 300)', '--accent-soft': 'oklch(0.72 0.14 300 / 0.16)', '--accent-text': 'oklch(0.82 0.12 300)' }
};
const TONES = {
  Charcoal: { '--bg-0': 'oklch(0.165 0.004 270)', '--bg-1': 'oklch(0.205 0.004 270)', '--bg-2': 'oklch(0.245 0.005 270)', '--bg-3': 'oklch(0.29 0.006 270)' },
  Graphite: { '--bg-0': 'oklch(0.16 0 0)', '--bg-1': 'oklch(0.20 0 0)', '--bg-2': 'oklch(0.24 0 0)', '--bg-3': 'oklch(0.285 0 0)' },
  Slate:    { '--bg-0': 'oklch(0.17 0.018 255)', '--bg-1': 'oklch(0.21 0.018 255)', '--bg-2': 'oklch(0.25 0.018 255)', '--bg-3': 'oklch(0.30 0.02 255)' }
};

function applyTweaks(t) {
  const root = document.documentElement.style;
  Object.entries(ACCENTS[t.accent] || ACCENTS.Azure).forEach(([k, v]) => root.setProperty(k, v));
  Object.entries(TONES[t.tone] || TONES.Charcoal).forEach(([k, v]) => root.setProperty(k, v));
  document.body.classList.toggle('compact', t.density === 'Compact');
}

function LumenTweaks() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => { applyTweaks(t); }, [t]);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Accent" />
      <TweakRadio label="Accent color" value={t.accent}
        options={['Azure', 'Teal', 'Amber', 'Violet']}
        onChange={v => setTweak('accent', v)} />
      <TweakSection label="Surface" />
      <TweakRadio label="Background tone" value={t.tone}
        options={['Charcoal', 'Graphite', 'Slate']}
        onChange={v => setTweak('tone', v)} />
      <TweakRadio label="Density" value={t.density}
        options={['Comfortable', 'Compact']}
        onChange={v => setTweak('density', v)} />
    </TweaksPanel>
  );
}

(function mount() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  ReactDOM.createRoot(div).render(<LumenTweaks />);
})();
