# ReserveFlow specifications

The final product specification is authored in [`spec/sections/`](spec/sections/) and compiled
into one self-contained HTML document. Edit the Markdown sources, not the generated HTML.

- [`spec/BUILD-CONTRACT.md`](spec/BUILD-CONTRACT.md) — authoring, diagram, accessibility, and build rules
- [`ReserveFlow_Spec.html`](ReserveFlow_Spec.html) — generated standalone specification
- [`ReserveFlow_Spec.artifact.html`](ReserveFlow_Spec.artifact.html) — generated artifact-compatible copy
- [`spec/CHANGE-BRIEF.md`](spec/CHANGE-BRIEF.md) — binding client decisions applied to the specification
- [`spec/PENDING-FIXES.md`](spec/PENDING-FIXES.md) — historical review decisions and constraints
- [`UI-HANDOFF.md`](UI-HANDOFF.md) — as-built employee UI/UX contract
- [`DATABASE-INITIALIZATION.md`](DATABASE-INITIALIZATION.md) — canonical one-shot database bootstrap
- [`DEMO-SEED.md`](DEMO-SEED.md) — protected disposable demo-data workflow
- [`DEPLOY.md`](DEPLOY.md) — production deployment runbook
- [`AI-USAGE.md`](AI-USAGE.md) — AI-assisted session disclosure log

From the repository root, bootstrap the ignored Python environment once and regenerate both HTML
outputs:

```sh
python3 -m venv docs/spec/build/.venv
docs/spec/build/.venv/bin/python -m pip install -r docs/spec/build/requirements.txt
docs/spec/build/.venv/bin/python docs/spec/build/build.py
```

Mermaid SVGs are content-hash cached in `spec/diagrams/`. Changing a Mermaid block additionally
requires Chrome and `MERMAID_JS` pointing to a local `mermaid.min.js`; unchanged diagrams rebuild
without that renderer dependency.

Run the renderer contract tests independently with:

```sh
docs/spec/build/.venv/bin/python docs/spec/build/build.py --selftest
```
