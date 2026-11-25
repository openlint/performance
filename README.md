# OpenLint Performance

How fast is each [OpenLint](https://github.com/openlint/openlint) release on real OpenAPI documents, and did a change make it slower? This project times every OpenLint release since 1.0.0, alongside [Spectral](https://github.com/stoplightio/spectral), [vacuum](https://github.com/daveshanley/vacuum), [Redocly CLI](https://github.com/Redocly/redocly-cli) and the [IBM OpenAPI Validator](https://github.com/IBM/openapi-validator), on OpenAPI descriptions that leading API providers publish on GitHub. It publishes the results at **[performance.openlint.org](https://performance.openlint.org/)**.

It's the sibling of [conformance.openlint.org](https://conformance.openlint.org/), which checks whether linters give the right results. This one checks how long they take, and how much memory they use, to get there.

## The documents

[`corpus.yaml`](corpus.yaml) lists the documents, from the 23 KB Swagger Petstore to Cloudflare's 30 MB description. Each document:
- comes from the provider's own public GitHub repository;
- is **pinned to a commit**, so every run lints identical bytes and results stay comparable over time;
- is **downloaded at run time**, never copied into this repo;
- has a size tier (`xs` to `xl`) that sets how many times it's run.

To add an API, add an entry to `corpus.yaml` and run `npm run pin` to fill in its commit and size. Prefer documents that differ from the ones already here: a new size, a description split across many files, Swagger 2.0, OpenAPI 3.1, heavy use of `$ref`, very large schemas.

To move every document to its latest commit, run `npm run pin`. Results before and after a pin aren't comparable, so pins change rarely and on purpose.

## What's measured

- **Time:** wall-clock time to lint the document from the command line, including starting the tool, because that's what users wait for. One untimed warm-up, then 5 timed runs (3 for documents over 2 MB). The median is reported.
- **Memory:** peak resident set size, from `/usr/bin/time`.
- **Problems:** how many results the tool reported. If a new OpenLint release reports a different number on the same document with the same ruleset, its results changed, not just its speed.

Every OpenLint release is run on the same machine in the same run, so the comparison between releases is fair even when the machine changes. Absolute times depend on the machine, which is recorded with every run.

**The ruleset:** OpenLint, Spectral, vacuum and the IBM validator all run [`rulesets/spectral-oas.yaml`](rulesets/spectral-oas.yaml), which extends `spectral:oas`. That ruleset is frozen at 1.0.0 from OpenLint 1.3, so a change in timing comes from the engine. Redocly can't read Spectral rulesets and runs its own recommended rules. Tools implement the same rules differently and report different numbers of problems, so treat comparisons across tools as a guide.

## Run it

```
npm install
npm run fetch    # download the documents into corpus/
npm run tools    # install every OpenLint release and the latest of each other tool into tools/
npm run bench    # writes results/latest.json, results/runs/, and appends to results/history.jsonl
```

`node run.mjs --docs petstore,stripe --tools openlint@1.3.0` runs a subset, which isn't published. `--runs N` overrides the repeat count, and `--timeout S` the per-run limit (default 600 seconds).

A [GitHub Action](.github/workflows/performance.yml) checks daily for a new OpenLint release, runs the full benchmark when one appears and every Monday, commits the results, and publishes [`site/`](site/).

## Adding a tool

Add it to `toolList()` in [`tools.mjs`](tools.mjs), and teach `command()` and `problems()` in [`run.mjs`](run.mjs) how to run it and count its results. Tool maintainers are welcome to contribute or correct their own entry.

## License

[Apache-2.0](LICENSE). The OpenAPI documents belong to their providers and are used under their own licenses; this repository links to them and doesn't redistribute them.
