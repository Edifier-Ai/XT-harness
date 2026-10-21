# Magpie community plugins (vendored)

Unchanged copies of two plugins from Magpie's community plugins
(https://github.com/magpie-community/plugins, MIT, used by https://github.com/yetone/magpie):

| File | npm package | Version |
|---|---|---|
| qoder-auth.mjs | @magpie-community/opencode-qoder-auth | 0.2.25 |
| workbuddy-auth.mjs | @magpie-community/opencode-workbuddy-auth | 0.1.28 |

天禧's free mode (desktop/freegate.js) drives them the way Magpie does: their sign-in
methods, their model lists (with Magpie's `free` mark) and their `fetch`.
To update, replace a file with the package's `index.mjs` and change the version above.
qoder-auth.mjs carries code from CLIProxyAPI, whose licence is LICENSE-CLIProxyAPI.

MIT License — Copyright (c) the magpie-community contributors. Permission is hereby granted,
free of charge, to any person obtaining a copy of this software and associated documentation
files, to deal in the Software without restriction, subject to the MIT License terms.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
