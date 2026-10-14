# entrainment

A generative murmuration — 4,096 birds simulated in real time on the GPU, reacting live to a radio stream.

## How it works

The simulation is built on the topological neighbor model described by [Ballerini et al. (2008)](https://www.pnas.org/doi/10.1073/pnas.0711437105). Each bird tracks only its **7 nearest neighbors** — not all birds within a fixed radius — and follows three rules:

- **Separation** — avoid collisions
- **Alignment** — match heading with neighbors
- **Cohesion** — stay close to the local group

The sweeping, organic motion emerges entirely from these local interactions. All 4,096 velocity updates run in parallel on the GPU via a WebGL compute pass using Three.js `GPUComputationRenderer`.

### Audio reactivity

The simulation is driven by a live stream from [DEF CON Radio](https://somafm.com/defcon/) on SomaFM:

| Signal | Effect |
|--------|--------|
| Kick drum | Scatters each bird away from its local flock center |
| Bass | Pushes sub-flocks apart with curl-noise bursts |
| Mids | Tightens alignment — birds lock into synchronized waves |
| Treble | Drives turbulent flutter via curl noise |
| Energy | Modulates overall speed and turn rate |

Kick detection uses an onset detector on a narrow frequency band (~0–170 Hz) with a lower-mids gate to avoid false triggers from chords and vocals.

## Running locally

```bash
npm install
npm run dev
```

Vite opens the page; click the music note to start the stream. The dev server also proxies `/stream` for iOS, which can't analyse the cross-origin stream directly.

## Controls

| Control | Description |
|---------|-------------|
| ♪ (bottom right) | Start stream / toggle mute |
| what's this? | About the project |
| &lt;/dev&gt; | Flock tuning panel: spectrogram, audio signals, and rule sliders (Esc closes) |

### Flock tuning panel

Each audio signal is plotted with the behaviour it drives; dashed lines on bass and treble mark the 0.3 threshold where scatter and swirl switch on.

- **Neighbor radius** (separation / alignment / cohesion): how close a neighbor must be for each rule to apply. The readout beside the heading shows how far away the 7 neighbors each bird actually finds are. Neighbors are drawn from 64 random candidates, not the true nearest, so a radius well above that figure changes nothing.
- **Strength** (separation / alignment / cohesion): weight of each rule.
- **Max speed**: top bird velocity.
- **Kick force**: how hard detected kicks push birds out from their local centre.

The orange value after each strength/motion slider is what the GPU is using this frame, after audio modulation. *Reset* restores the tuned defaults (`DEFAULT_PARAMS` in `physics.js`).

## Stack

- [Three.js](https://threejs.org/) — rendering and GPU compute
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — stream analysis
- [SomaFM DEF CON Radio](https://somafm.com/defcon/) — audio source
