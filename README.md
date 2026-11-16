# Stargazer

Stargazer turns Jibo into a window on the universe. He shows an astronomy picture from ESA/Hubble, ESA/Webb or NOIRLab, with its name, where it is in the sky and who took it.

Stargazer needs BEam 3.1.9 or newer and an internet connection.

![Stargazer on Jibo: a Webb picture with its caption, the settings, and a Hubble picture](banner.png)

## Using it

1. Install **Stargazer** from BEacon's **Store → Skills**, or use **⋮ → Upload Skill ZIP** with a release's `Stargazer.zip`. It becomes a button in the main menu.
2. Open it. A telescope eyepiece appears, looking at the horizon with grass along the bottom of the lens. It rises towards the top of the screen over the still landscape, until only sky shows, and looks around the sky, with Jibo's own telescope sounds. Its focus dial lights up as the picture loads. When the picture is in, the eyepiece settles at the top, the picture comes into focus inside the lens, and the lens opens up to the whole screen with a slow pan and zoom.
3. The caption has three lines:
   - the title;
   - what the picture shows, for example **M 30 · Capricornus · Hubble**;
   - who took it.
4. Jibo reads the title aloud. He reads only the title, never the long description.
5. After 10 seconds, Jibo's eye comes back. Touching the picture restarts that time.

Each time, Stargazer picks **one** source at random and shows its newest picture. It prefers a source that it knows has something new without downloading anything. Either that source's list is still in memory with an unseen newest picture, or the source's publishing rhythm (weekly or monthly) has passed since the last picture it showed. Only the chosen source is contacted. If it fails, Stargazer tries another one.

On the picture:
- **Tap:** shows the info overlay: the title, the source and date, the description (up to about 900 characters, in pages that fit the screen) and the credit. Swipe sideways to turn a page. The small gear in the top right corner opens **Settings**.
- **Swipe down:** goes back one level. On the picture it closes Stargazer.

## Settings

**Sources:** turn each source on or off. At least one stays on.

| Source | New pictures | Caption |
|---|---|---|
| ESA/Hubble Picture of the Month | monthly | object · constellation · Hubble |
| ESA/Webb Picture of the Month | monthly | object · constellation · Webb |
| NOIRLab Image of the Week | weekly | object or place · NOIRLab |

**Effects:** how a new picture appears.

| Effect | What it does | At first |
|---|---|---|
| Ken Burns | a slow pan and zoom across the picture; tall pictures are panned top to bottom | on |
| Telescope iris | Jibo's eye becomes a round lens that opens up into the picture | on |
| Look up | the eyepiece rises while Jibo tilts his head towards the sky | on |
| Starfield | stars stream out of the lens as the picture opens, then sparkle by the title | off |

**More:**
- **Show for:** how long the picture stays before Jibo's eye returns: 10 s, 30 s, 1 min, 5 min, or **Until I close it**.
- **Slideshow:** off, or a picture from another source every 1, 5 or 30 minutes. A running slideshow keeps Stargazer open.
- **Read title aloud:** on or off.
- **Read description aloud:** off by default. When on, Jibo reads the description after the title (up to 900 characters, on a sentence), or alone when the title is off. Turning it off, swiping to another picture or leaving Stargazer stops him.
- **Telescope sounds:** Jibo's tripod clicks as the eyepiece moves (on). They are played from Jibo's own sound library and are not part of this skill.
- **Show caption:** on or off.

## Pictures and credits

Every picture belongs to the people and organisations named in its caption.

| Source | Licence |
|---|---|
| ESA/Hubble, ESA/Webb, NOIRLab | Creative Commons Attribution 4.0 |

Stargazer shows each picture on Jibo with its credit, and does not copy, store or share it.

## Privacy

- **Memory only:** pictures are downloaded into memory and dropped once they leave the screen. They are never saved to disk.
- **What is stored:** only your settings, a short list of picture IDs already shown (for the "New" mark), and the newest picture last shown from each source (to pick a source with something new).
- **No account and no tracking.** Stargazer only asks the picture sources for their latest pictures.

## Build and test (development machine)

```sh
node --test tests/*.test.mjs                        # parsers (saved responses), settings, timers, effects
python3 tools/package.py                            # writes dist/Stargazer.zip and checks BEacon's limits
node tools/make-icons.mjs <path to playwright>      # only to redraw the icons
```

No npm or build step runs on the robot. The ZIP holds plain JavaScript and the icons. The skill runs on the robot's Node 6.9.2 and Chromium 53, so code under `stargazer/` must stay ES2015: no async/await, object spread, optional chaining or `Object.values`.

```
manifest.json, icon.png, banner.png, README.md   store files
stargazer/                    the @be/stargazer package (what runs on Jibo)
  lib/screen.js               the SDK view: picture layer, info overlay, menus, gestures
  lib/loader.js               tries the sources in order until one picture loads
  lib/presenter.js            shows pictures with the effects (lib/effects/*), caption (lib/caption.js)
  lib/opening.js              the first picture's opening: eyepiece search, focus pull, iris
  lib/model.js                navigation, settings menus, "Show for" and slideshow timers
  lib/catalog.js, sources/    the picture sources; picks one source (fresh first, random) per picture
  lib/images.js, net.js       downloads into memory, decodes to textures, frees them once off screen
  lib/effects/eyepiece.js     the eyepiece that searches the sky (from the horizon up) while the picture loads
  lib/sounds.js               Jibo's telescope sounds (played from his animation library)
  lib/motion.js               "Look up" on the body
  lib/settings.js             settings.json, seen.json and sources.json (what each source showed last)
tests/, tools/                development only; not in the ZIP
```

## Licence

The code is under the MIT License (see `LICENSE`, also included in the skill folder of the ZIP). The licence covers Stargazer's code and its own icons. It does not cover the pictures: each picture keeps its own licence and credit (see Pictures and credits). No firmware art or fonts are included; the text uses the robot's own Proxima Nova.
