# Third-party notices

Flame includes work adapted from the projects below. Thank you to their authors.

## T3 Code

Flame's Git workflow is adapted from [T3 Code](https://github.com/pingdotgg/t3code) (commit `6b286ae`). The adapted parts are:

- the context-aware Git action button, its options menu and their disabled-reason rules
  (`src/renderer/components/workspace/git/gitActionLogic.ts`)
- the commit, default-branch confirmation and publish repository dialogs, and progress toasts
  (`src/renderer/components/workspace/git/`, `src/renderer/components/toasts/`)
- the commit message and change request prompts (`src/backend/git/writer/prompts.ts`)
- the stacked commit, push and pull request flow, feature branch naming, completion summaries and hosting provider detection
  (`src/backend/git/actions/`, `src/backend/git/branch-names.ts`, `src/contracts/source-control.ts`)

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
