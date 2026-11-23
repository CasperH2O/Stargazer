# Stargazer: development

For developers. What Stargazer does, its settings, credits and privacy, as the owner reads them in
the 5x1 Store and BEacon, are in [README.md](README.md); this file has what is not in there.

## Behaviour in detail

- **Picking a source:** one source at random per picture, preferring one that is known to have
  something new without downloading anything: its list is still in memory with an unseen newest
  picture, or its rhythm (weekly or monthly) has passed since the last picture it showed. Only the
  chosen source is contacted; if it fails, the next one is tried, then the offline screen.
- **Info overlay:** the description up to about 900 characters, cut on a sentence, in pages that fit
  the screen.
- **Reading aloud:** the title and/or the description (up to 900 characters) in pieces of at most
  450 characters, said one after another; any stop of Jibo's speech ends the reading. The show time
  waits for the reading to end, at most 2 minutes.
- **Open while on screen:** a launch phrase while Stargazer shows makes Be call `open()` without
  `close()`; Stargazer closes its view and plays a new opening.
- **Open by voice:** `phrases` in `manifest.json` ("stargazer", "show me the stars", ...). BEam
  matches the whole sentence after "Hey Jibo" on the robot, from the cloud's transcript
  (`beacon/lib/launch-phrases.js`), and the skill needs no permission for it. `open()` does not read
  what opened it. README.md lists the phrases; `tests/manifest.test.mjs` keeps the two in step.
- **Permissions:** none. Files only in its own Knowledge folder, network only to the public picture
  servers; `tests/manifest.test.mjs` fails when the code starts to need one.

## Build and test (development machine)

```sh
node --test tests/*.test.mjs                        # parsers (saved responses), settings, timers, effects
python3 tools/package.py                            # writes dist/Stargazer.zip and checks BEacon's limits
node tools/make-icons.mjs <path to playwright>      # only to redraw the icons
```

No npm or build step runs on the robot. The ZIP holds plain JavaScript and the icons. The skill runs on the robot's Node 6.9.2 and Chromium 53, so code under `stargazer/` must stay ES2015: no async/await, object spread, optional chaining or `Object.values`.

```
manifest.json, icon.png, banner.png, README.md   store files (README.md is the Store text; no tables)
DEVELOPMENT.md                this file, not in the ZIP
stargazer/                    the @be/stargazer package (what runs on Jibo)
  lib/screen.js               the SDK view: picture layer, info overlay, menus, gestures, reading aloud
  lib/loader.js               tries the sources in order until one picture loads
  lib/presenter.js            shows pictures with the effects (lib/effects/*), caption (lib/caption.js)
  lib/opening.js              the first picture's opening: eyepiece search, focus pull, iris
  lib/model.js                navigation, settings menus, "Show for" and slideshow timers
  lib/catalog.js, sources/    the picture sources; picks one source (fresh first, random) per picture
  lib/images.js, net.js       downloads into memory, decodes to textures, frees them once off screen
  lib/effects/eyepiece.js     the eyepiece that searches the sky (from the horizon up) while the picture loads
  lib/speech.js               the spoken text: cleaned, split into pieces, escaped
  lib/sounds.js               Jibo's telescope sounds (played from his animation library)
  lib/motion.js               "Look up" on the body
  lib/settings.js             settings.json, seen.json and sources.json (what each source showed last), in its own Knowledge folder
tests/, tools/                development only; not in the ZIP
```

## Licence

The code is under the MIT License (see `LICENSE`, also included in the skill folder of the ZIP). The licence covers Stargazer's code and its own icons. It does not cover the pictures: each picture keeps its own licence and credit. No firmware art or fonts are included; the text uses the robot's own Proxima Nova.
