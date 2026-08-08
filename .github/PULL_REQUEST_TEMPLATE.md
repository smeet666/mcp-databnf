## What this changes

<!-- One or two sentences. What the server does differently after this. -->

## Why

<!-- Link the issue we discussed it in. If there is none, say what happened
     that made this necessary, and expect the discussion to happen here. -->

## How it was checked

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Live suite (`BNF_LIVE=1 npm run test:live`) if the parsing layer changed
- [ ] Driven by hand in the MCP Inspector, if the change is visible to a caller

## Contract

- [ ] Tool names, argument names and output fields are unchanged, or the change
      is called out here as breaking
- [ ] Every new output field has a `.describe()` saying what it means
- [ ] A failure is still never reported as an empty result
- [ ] Results still carry their source link
- [ ] The floor on the interval between requests still holds
