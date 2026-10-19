# lanes templates

Command documents for `lanes`: what runs when a lane opens, when it is created and when it is removed. Point a base at
one during `lanes init` (the "Command lists to load" question), or set it as the base's `template` in `.lanes.json`. After
that, `lanes commands update` refreshes the lists from the document.

| File | What it does |
| --- | --- |
| `default.json` | Two Warp tabs in the lane folder: `Claude` (runs `claude --continue`) and `Terminal` |

`default` is built into `lanes`, so you can load it by name. To load a document from this folder by URL instead, or one
you keep somewhere else, use its address as the source:

```
https://github.com/anvk/lanes/blob/main/templates/default.json
```

A document is a JSON object with any of `open`, `create` and `remove`. Each is a list of shell command lines:
`lanes warp tab …` for a Warp tab, or anything else, such as `cursor .`. A document can also have `plugins`, which says
where to install the plugins those lines use. The main README has the details. Documents in the older form, an array of
tab objects, still load.

When you change `default.json`, change `cli/src/hooks/templates.ts` too. A test checks that the two match.
