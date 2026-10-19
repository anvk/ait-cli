# lanes templates

Command documents for `lanes`: what runs when a lane opens, when it is created and when it is removed. Load one with
`lanes init <URL or path>`, or answer the "Command lists to load" question with it. It is saved as the base's
`template` in `.lanes.json`, and `lanes commands update` refreshes the lists from it later.

| File | What it does |
| --- | --- |
| `default.json` | Two Warp tabs in the lane folder: `Claude` (runs `claude --continue`) and `Terminal` |

Load it by its GitHub address:

```bash
lanes init https://github.com/anvk/lanes/blob/main/templates/default.json
```

A team's own document works the same way: host it anywhere, such as in a GitHub repository, and pass its URL.

A document is a JSON object with any of `open`, `create` and `remove`. Each is a list of shell command lines:
`lanes warp tab …` for a Warp tab, or anything else, such as `cursor .`. A document can also have `plugins`, which says
where to install the plugins those lines use. The main README has the details. Documents in the older form, an array of
tab objects, still load.
