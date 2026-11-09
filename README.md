# Joel's projects

Fun side projects, published at [joelisjoel.org](https://joelisjoel.org/).

| Path | What it is |
|---|---|
| `index.html` | The landing page |
| `data-arts/` | The Data Arts Working Group: a weekly issue, published Fridays at 9am Pacific |
| `snake/`, `snake3/` | Snake 2.5D and Snake 3D |
| `cube/` | The rotating cube demo |
| `metacube/` | A cube of six tiny dioramas |
| `worldview/`, `globe2/` | The World Pulse globe |

Skywyrm, the dragon game, has its own home at [skywyrm.io](https://skywyrm.io)
([joelisjoel/skywyrm](https://github.com/joelisjoel/skywyrm)). These pages
moved here from dendroslabs.com, which is now just data explorations.

Everything is static: GitHub Pages serves this repo's `main` branch as is.

## Data Arts Working Group

`data-arts/` is a weekly publication at
[joelisjoel.org/data-arts](https://joelisjoel.org/data-arts/). Each issue is
`data-arts/issues/NNN/` (`issue.json`, `body.html`, `assets/`); the pages,
RSS feed and the landing-page card are generated:

```bash
node data-arts/_tools/build.mjs   # render pages, feed and landing block
node data-arts/_tools/check.mjs   # safety and link checks; must pass
```

A scheduled Claude task runs the `data-arts-weekly` skill
(`.claude/skills/data-arts-weekly/SKILL.md`) every Friday morning: it takes the
next issue from the Data Arts Working Group folder in Google Drive, builds and
checks it, and pushes it to `main`.
