# AGENTS.md

Operational guide for `@askrjs/vite`, which owns explicit Askr JSX and template
transforms inside Vite.

## Askr North Star

Keep each transform narratable from configured input through emitted output.
Reject invalid plugin options, unsupported syntax, and ambiguous transforms at
the source boundary with errors that identify the file and correction. Test
success, parse failure, build failure, and generated-output contracts using real
Vite builds. Keep JSX, template, image, and build integration as visible seams.
Prefer explicit plugin options and declarations over file discovery or hidden
auto-wiring. Add transform surface only for demonstrated application needs.

Run `npm run check` before declaring a change ready.

## Optimization Gate

A benchmark number is only half of an optimization's success criterion. The
change must also preserve a causal path that a human or agent can narrate in one
sentence.

Every benchmark-driven change must include:

1. the one-sentence causal description of the optimized path;
2. the exact fallback trigger and proof that optimized and fallback paths have
   identical observable behavior and error surfaces;
3. an explicit legibility-cost statement, including `none` when no new path or
   concept is introduced; and
4. evidence that a measured bottleneck in a real application justifies the
   optimization now.

Prefer making the existing single path faster. New caches, inference,
memoization, shortcuts, fast paths, or scheduler states require an explicit
legibility decision; a speedup alone does not justify them.
